const {enterGame}=require('./fixtures.cjs');
const {test,expect}=require('@playwright/test');

async function prepare(page){
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());await page.goto('/');await enterGame(page);
  await page.locator('#new-button').click();await page.locator('#seed-input').fill('stage-item-7');await page.locator('#start-button').click();
  await page.locator('#speed').evaluate(input=>{input.value='200';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#board > [data-index="45"]').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:15000});
  const slot=page.locator('#item-slots [data-item-slot="0"]');await expect(slot).toHaveAttribute('data-item','row');await expect(slot).toBeEnabled();return slot;
}
async function moveItem(page,slot,target,mobile){
  await slot.scrollIntoViewIfNeeded();const a=await slot.locator('.item-slot-icon svg').boundingBox(),b=await target.boundingBox(),from={x:a.x+a.width/2,y:a.y+a.height/2},to={x:b.x+b.width/2,y:b.y+b.height/2};
  if(!mobile){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+2,from.y+2);await page.mouse.move(to.x,to.y,{steps:16});return {end:()=>page.mouse.up(),cancel:async()=>{await page.keyboard.press('Escape');await page.mouse.up();}};}
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
  for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12}]});
  return {end:async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();},cancel:async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();}};
}

test('pointer dragging from the item icon works without native HTML drag events',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));const slot=await prepare(page),index=await page.locator('#board > button[aria-disabled="false"]:not([data-item])').first().getAttribute('data-index'),target=page.locator(`#board > [data-index="${index}"]`),score=await page.locator('#score').textContent(),moves=await page.locator('#remaining-moves').textContent();
  await page.evaluate(()=>document.addEventListener('dragstart',event=>event.preventDefault(),true));
  const drag=await moveItem(page,slot,target,info.project.name==='mobile');await expect(page.locator('.item-drag-ghost')).toBeVisible();await expect(target).toHaveClass(/item-drop-target/);await drag.end();
  await expect(target).toHaveAttribute('data-item','row');await expect(page.locator('#item-capacity')).toHaveText('0 / 3');await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#score')).toHaveText(score);await expect(page.locator('#remaining-moves')).toHaveText(moves);await expect(page.locator('.item-drag-ghost')).toHaveCount(0);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('pointer-item-equipped.png'),fullPage:true});
});

test('cancelled pointer drags retain the item and a special card still accepts a drop',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));const slot=await prepare(page),index=await page.locator('#board > .chain-only:not([data-item])').first().getAttribute('data-index'),target=page.locator(`#board > [data-index="${index}"]`),mobile=info.project.name==='mobile',moves=await page.locator('#remaining-moves').textContent();
  const cancelled=await moveItem(page,slot,target,mobile);await expect(target).toHaveClass(/item-drop-target/);await cancelled.cancel();await expect(page.locator('.item-drag-ghost')).toHaveCount(0);await expect(page.locator('#board')).not.toHaveClass(/placing-item/);await expect(page.locator('#item-capacity')).toHaveText('1 / 3');await expect(target).not.toHaveAttribute('data-item',/.+/);
  const drag=await moveItem(page,slot,target,mobile);await expect(target).toHaveClass(/item-drop-target/);await drag.end();await expect(target).toHaveAttribute('data-item','row');await expect(target).toHaveAttribute('aria-disabled','true');await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#remaining-moves')).toHaveText(moves);await expect(page.locator('#item-capacity')).toHaveText('0 / 3');expect(errors).toEqual([]);
});
