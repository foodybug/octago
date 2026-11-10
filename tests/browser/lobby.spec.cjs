const {test,expect}=require('@playwright/test');
const E=require('../../engine.js');
async function speed(page){await page.locator('#speed').evaluate(input=>{input.value='200';input.dispatchEvent(new Event('input',{bubbles:true}));});}
function nextQuiet(state){const index=state.board.findIndex((card,i)=>!E.isSpecial(card)&&E.connections(state,i).length===0);if(index<0)throw Error('No quiet card');let next=E.begin(state,index);while(next.status==='running'&&next.phase<100)next=E.step(next);return {index,state:E.complete(next)};}
async function start(page,name){await page.goto('/');await page.locator('#player-name').fill(name);await page.locator('#title-start').click();await speed(page);return E.create(await page.locator('#current-seed').textContent());}
async function finish(page,state){let last;while(state.status!=='gameover'){last=nextQuiet(state);await page.locator(`#board > [data-index="${last.index}"]`).click();state=last.state;await expect(page.locator('#board')).toHaveAttribute('data-status',state.status,{timeout:15000});}return {state,lastIndex:last.index};}
test.beforeEach(async({page})=>{await page.route('https://fonts.googleapis.com/**',route=>route.abort());});

test('the title shows server rankings and starting, returning home, and continuing preserve a run',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');await expect(page.locator('#title-screen')).toBeVisible();await expect(page.locator('#game-screen')).toBeHidden();await expect(page.locator('#server-status')).toHaveAttribute('data-status','connected');
  await expect(page.locator('#title-continue')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);await page.screenshot({path:info.outputPath('octago-title.png'),fullPage:true});
  await page.locator('#player-name').fill('시작-'+info.project.name);await page.locator('#title-start').click();await expect(page.locator('#game-screen')).toBeVisible();await speed(page);
  const step=nextQuiet(E.create(await page.locator('#current-seed').textContent()));await page.locator(`#board > [data-index="${step.index}"]`).click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle');
  await page.locator('#title-home').click();await expect(page.locator('#title-screen')).toBeVisible();await expect(page.locator('#title-continue')).toBeVisible();await page.locator('#title-continue').click();await expect(page.locator('#moves')).toHaveText('01');await expect(page.locator('#score')).toHaveText(String(step.state.score));expect(errors).toEqual([]);
});

test('a completed run shows score, reached stage and server rank, and remains in the title after reload',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));const name='기록-'+info.project.name,initial=await start(page,name),done=await finish(page,initial);
  await expect(page.locator('#result-dialog')).toBeVisible();await expect(page.locator('#result-status')).toHaveAttribute('data-status','saved',{timeout:15000});await expect(page.locator('#gameover-score')).toHaveText(done.state.score.toLocaleString('en-US'));await expect(page.locator('#result-stage')).toHaveText(String(done.state.moves).padStart(2,'0'));await expect(page.locator('#result-rank')).toHaveText(/\d+위/);
  await expect(page.locator('#result-leaderboard .my-record')).toContainText(name);await expect(page.locator('#result-leaderboard .my-record')).toContainText('STAGE 03');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);await page.screenshot({path:info.outputPath('octago-results.png')});
  await page.locator('#result-home').click();await expect(page.locator('#title-screen')).toBeVisible();await expect(page.locator('#title-leaderboard')).toContainText(name);await page.reload();await expect(page.locator('#title-leaderboard')).toContainText(name);await expect(page.locator('#player-name')).toHaveValue(name);await expect(page.locator('#personal-score')).toHaveText('300');await expect(page.locator('#personal-stage')).toHaveText('STAGE 03');expect(errors).toEqual([]);
});

test('failed saves can retry and replaying an undone finish updates the same server record',async({page},info)=>{
  let attempts=0;const payloads=[];
  await page.route('**/api/scores',async route=>{payloads.push(route.request().postDataJSON());if(++attempts===1)await route.fulfill({status:503,json:{error:'저장 연결을 다시 확인해 주세요.'}});else await route.continue();});
  const before=await page.request.get('/api/leaderboard').then(r=>r.json()),initial=await start(page,'재시도-'+info.project.name),done=await finish(page,initial);
  await expect(page.locator('#result-status')).toHaveAttribute('data-status','error');await expect(page.locator('#result-retry')).toBeVisible();await page.locator('#result-retry').click();await expect(page.locator('#result-status')).toHaveAttribute('data-status','saved');
  const saved=await page.request.get('/api/leaderboard').then(r=>r.json());expect(saved.total).toBe(before.total+1);await page.locator('#undo-gameover').click();await expect(page.locator('#result-dialog')).toBeHidden();await expect(page.locator('#remaining-moves')).toHaveText('1');
  await page.locator(`#board > [data-index="${done.lastIndex}"]`).click();await expect(page.locator('#board')).toHaveAttribute('data-status','gameover');await expect(page.locator('#result-status')).toHaveAttribute('data-status','saved');await expect.poll(()=>attempts).toBe(3);
  const replayed=await page.request.get('/api/leaderboard').then(r=>r.json());expect(replayed.total).toBe(saved.total);expect(payloads.map(p=>p.runId)).toEqual([payloads[0].runId,payloads[0].runId,payloads[0].runId]);expect(payloads.map(p=>p.revision)).toEqual([1,1,2]);
});
