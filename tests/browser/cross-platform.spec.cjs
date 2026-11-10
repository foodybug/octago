const {test,expect}=require('@playwright/test');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../../server.cjs');
const E=require('../../engine.js');
let api,client,apiUrl,clientUrl;
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return 'http://127.0.0.1:'+server.address().port;}
test.beforeAll(async()=>{
  const file=tag=>path.join(__dirname,'../../artifacts/ranking-'+tag+'-'+crypto.randomUUID()+'.json');
  api=await createServer({dataFile:file('shared'),allowedOrigins:['*']});apiUrl=await listen(api);
  client=await createServer({dataFile:file('client'),apiBaseUrl:apiUrl});clientUrl=await listen(client);
});
test.afterAll(async()=>{for(const server of [client,api])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});

test('PC and mobile clients on different origins share a common ranking server without randomUUID',async({page,browser},info)=>{
  const opposite=info.project.name==='desktop'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:1000}};
  const other=await browser.newContext(opposite),reader=await other.newPage(),errors=[];
  try{
    for(const tab of [page,reader]){tab.on('pageerror',error=>errors.push(error.message));await tab.route('https://fonts.googleapis.com/**',route=>route.abort());}
    // LAN HTTP and some app WebViews expose getRandomValues but not randomUUID.
    await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
    await page.goto(clientUrl);await reader.goto(clientUrl.replace('127.0.0.1','localhost'));
    await expect(page.locator('#server-status')).toHaveAttribute('data-status','connected');await expect(reader.locator('#server-status')).toHaveAttribute('data-status','connected');
    expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
    const name='공유-'+info.project.name;await page.locator('#player-name').fill(name);await page.locator('#title-start').click();
    await page.locator('#speed').evaluate(input=>{input.value='200';input.dispatchEvent(new Event('input',{bubbles:true}));});
    let state=E.create(await page.locator('#current-seed').textContent());
    const saved=page.waitForResponse(response=>response.url()===apiUrl+'/api/scores'&&response.request().method()==='POST');
    while(state.status!=='gameover'){
      const index=state.board.findIndex((card,i)=>!E.isSpecial(card)&&!E.connections(state,i).length);expect(index).toBeGreaterThanOrEqual(0);
      state=E.begin(state,index);while(state.status==='running')state=E.step(state);state=E.complete(state);
      await page.locator(`#board > [data-index="${index}"]`).click();await expect(page.locator('#board')).toHaveAttribute('data-status',state.status);
    }
    expect((await saved).status()).toBe(200);await expect(page.locator('#result-status')).toHaveAttribute('data-status','saved');await expect(page.locator('#result-rank')).toHaveText('1위');
    await reader.locator('#leaderboard-refresh').click();await expect(reader.locator('#title-leaderboard')).toContainText(name);await expect(reader.locator('#title-leaderboard')).toContainText('STAGE 03');await expect(reader.locator('#personal-score')).toHaveText('0');
    const shared=await page.request.get(apiUrl+'/api/leaderboard').then(response=>response.json()),separate=await page.request.get(clientUrl+'/api/leaderboard').then(response=>response.json());
    expect(shared.total).toBe(1);expect(separate.total).toBe(0);expect(errors).toEqual([]);
  }finally{await other.close();}
});
