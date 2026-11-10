const {enterGame}=require('./fixtures.cjs');
const {test,expect}=require('@playwright/test');
const E=require('../../engine.js');
const fmt=n=>n.toLocaleString('en-US');
function finish(state,index){let s=E.begin(state,index);while(s.status==='running'&&s.phase<100)s=E.step(s);if(s.status!=='settling')throw Error('Fixture chain is too long');return E.complete(s);}
async function speed(page,value){await page.locator('#speed').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function dragItem(page,from,to,mobile){
  if(!mobile){await from.dragTo(to);return;}
  await from.scrollIntoViewIfNeeded();const a=await from.boundingBox(),b=await to.boundingBox(),cdp=await page.context().newCDPSession(page);
  const start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+b.width/2,y:b.y+b.height/2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
test.beforeEach(async({page})=>{await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('/');await enterGame(page);});
for(const [type,seed,source] of [['row','stage-item-7',45],['column','stage-item-1',43],['adjacent','stage-item-6',30]]){
  test(`acquire and drag the ${type} item, then activate its full range`,async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));const mobile=info.project.name==='mobile';
    await page.locator('#new-button').click();await page.locator('#seed-input').fill(seed);await page.locator('#start-button').click();
    await expect(page.locator('#item-slots .item-slot')).toHaveCount(3);await expect(page.locator('#item-capacity')).toHaveText('0 / 3');
    let prepared=E.create(seed);await speed(page,200);
    await expect(page.locator('#board > [data-mystery="true"]:not([data-persistent-mystery="true"])')).toHaveCount(1);await expect(page.locator('#board > [data-bonus="true"]')).toHaveCount(3);
    const earned=finish(prepared,source);expect(earned.inventory[0]).toBe(type);
    await page.locator(`#board > [data-index="${source}"]`).click();
    const slot=page.locator('#item-slots [data-item-slot="0"]');await expect(slot).toHaveAttribute('data-item',type);await expect(slot).toBeDisabled();
    await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:12000});await expect(slot).toBeEnabled();await expect(page.locator('#item-capacity')).toHaveText('1 / 3');
    await expect(page.locator('#board > [data-mystery="true"]:not([data-persistent-mystery="true"])')).toHaveCount(1);
    if(mobile)await slot.tap();else await slot.click();
    await expect(page.locator('#board')).not.toHaveClass(/placing-item/);await expect(page.locator('#item-slots .selected, #item-slots .dragging, .item-drag-ghost')).toHaveCount(0);await expect(page.locator('#item-capacity')).toHaveText('1 / 3');await expect(page.locator('#moves')).toHaveText('01');
    await page.screenshot({path:info.outputPath(`inventory-${type}.png`),fullPage:true});
    await dragItem(page,slot,page.locator('#game-screen h1'),mobile);await expect(page.locator('#item-capacity')).toHaveText('1 / 3');
    const index=E.isSpecial(earned.board[36])?earned.board.findIndex(card=>!E.isSpecial(card)):36,target=page.locator(`#board > [data-index="${index}"]`);await dragItem(page,slot,target,mobile);
    await expect(target).toHaveAttribute('data-item',type);await expect(target.locator(':scope > .card-inner .card-item')).toHaveAttribute('data-item',type);await expect(page.locator('#item-capacity')).toHaveText('0 / 3');
    await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#moves')).toHaveText('01');await expect(page.locator('#score')).toHaveText(fmt(earned.score));
    if(type==='row'){
      await page.locator('#undo-button').click();await expect(slot).toHaveAttribute('data-item',type);await expect(target.locator('.card-item')).toHaveCount(0);
      const special=page.locator('#board > .chain-only').first();await page.waitForTimeout(320);await dragItem(page,slot,special,mobile);await expect(special).toHaveAttribute('data-item',type);await expect(special).toHaveAttribute('aria-disabled','true');
      await page.waitForTimeout(320);await special.click({force:true});await expect(page.locator('.toast')).toHaveText('연쇄 전용 카드입니다. 일반 카드에서 연쇄를 이어보세요.');await expect(page.locator('#moves')).toHaveText('01');await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#chain-preview')).toBeHidden();
      await page.screenshot({path:info.outputPath('equipped-locked-row.png'),fullPage:true});await page.locator('#undo-button').click();await expect(slot).toHaveAttribute('data-item',type);
      await page.waitForTimeout(320);await dragItem(page,slot,target,mobile);await expect(target).toHaveAttribute('data-item',type);
    }
    const equipped=E.equip(earned,0,index),trace=E.preview(equipped,index);
    await expect(page.locator('#preview-cards')).toHaveText(String(trace.cards.length));
    await page.screenshot({path:info.outputPath(`equipped-${type}.png`),fullPage:true});
    await page.waitForTimeout(320);await speed(page,1200);await target.click();await page.locator('#pause-button').click();await page.locator('#step-button').click();
    const p1=E.step(E.begin(equipped,index));expect(await page.locator('#board > .queued').evaluateAll(cards=>cards.map(card=>Number(card.dataset.index)))).toEqual(p1.frontier);
    await expect(page.locator('#links .item-signal')).toHaveCount(p1.lastEvent.links.filter(link=>link.item).length);await expect(target.locator('.destroy-ghost .card-item')).toHaveCount(1);
    await page.screenshot({path:info.outputPath(`activated-${type}.png`),fullPage:true});
    await page.locator('#step-button').click();await expect(page.locator('#active-count')).toHaveText(`${p1.frontier.length} CARDS`);expect(errors).toEqual([]);
  });
}
