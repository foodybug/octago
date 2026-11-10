const {test,expect}=require('@playwright/test');
const E=require('../../engine.js');
const {withStartingMoves,enterGame}=require('./fixtures.cjs');
const code=card=>card.sides.map(side=>side===null?'-':side?'1':'0').join('');
function play(state,index){let s=E.begin(state,index);const phases=[];while(s.status==='running'&&s.phase<100){s=E.step(s);phases.push(s);}if(s.status!=='settling')throw Error('Fixture chain too long');return {state:E.complete(s),phases};}
async function speed(page,value){await page.locator('#speed').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}

test('a cyan queued mystery keeps its field position across stages, rewards a chain, and is restored by undo',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('https://fonts.googleapis.com/**',route=>route.abort());await withStartingMoves(page,8);await page.goto('/');await enterGame(page);
  await page.locator('#new-button').click();await page.locator('#seed-input').fill('persistent-ui-4');await page.locator('#start-button').click();await speed(page,200);
  const initial={...E.create('persistent-ui-4'),remainingMoves:8},first=play(initial,5).state,second=play(first,8).state,played=play(second,1),rewardPhase=played.phases.find(s=>s.lastEvent.itemRewards.some(reward=>reward.index===5)),reward=rewardPhase.lastEvent.itemRewards.find(reward=>reward.index===5);
  expect(initial.queue[0].persistentMystery).toBe(true);expect(first.board[5]).toBe(initial.queue[0]);expect(second.board[5]).toBe(initial.queue[0]);
  const head=page.locator('#card-queue .queue-item').first();await expect(head).toHaveAttribute('data-persistent-mystery','true');await expect(head.locator('.persistent-loot')).toBeVisible();await expect(head.locator('.card')).toHaveAttribute('aria-label',/청록색 보존 물음표/);
  await expect(head.locator('.persistent-loot')).toHaveCSS('background-color','rgb(220, 251, 255)');await expect(page.locator('#persistent-mystery-count')).toHaveText('0');
  await page.locator('#game-screen h1').hover();await page.screenshot({path:info.outputPath('persistent-mystery-queue.png'),fullPage:true});
  await page.locator('#board > [data-index="5"]').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:15000});
  const persistent=page.locator('#board > [data-index="5"]');await expect(persistent).toHaveAttribute('data-persistent-mystery','true');await expect(persistent).toHaveClass(/persistent-mystery/);await expect(persistent).toHaveAttribute('aria-disabled','true');
  await expect(page.locator('#special-mystery-count')).toHaveText('1');await expect(page.locator('#persistent-mystery-count')).toHaveText('1');
  const sides=await persistent.locator(':scope > .card-inner .side-arrow').evaluateAll(arrows=>arrows.map(arrow=>({d:Number(arrow.dataset.direction),out:arrow.classList.contains('out')})));
  expect(sides).toEqual(initial.queue[0].sides.flatMap((out,d)=>out===null?[]:[{d,out}]));
  await page.locator('#board > [data-index="8"]').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:15000});await expect(page.locator('#stage-number')).toHaveText('03');
  await expect(persistent).toHaveAttribute('data-persistent-mystery','true');await expect(persistent.locator(':scope > .card-inner .persistent-loot')).toHaveCSS('color','rgb(8, 127, 140)');
  const ordinary=page.locator('#board > [data-mystery="true"][data-persistent-mystery="false"] > .card-inner .card-loot');await expect(ordinary).toHaveCSS('background-color','rgb(255, 248, 215)');
  if(info.project.name==='mobile')await persistent.tap({force:true});else await persistent.click({force:true});await expect(page.locator('#moves')).toHaveText('02');await expect(page.locator('#item-capacity')).toHaveText('0 / 3');
  await persistent.hover();await expect(page.locator('#inspect-detail')).toContainText('같은 자리 유지');await expect(page.locator('#chain-preview')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#game-screen h1').hover();await page.screenshot({path:info.outputPath('persistent-mystery-stage-three.png'),fullPage:true});
  await speed(page,1200);await page.locator('#board > [data-index="1"]').click();await page.locator('#pause-button').click();for(let phase=1;phase<=rewardPhase.phase;phase++)await page.locator('#step-button').click();
  await expect(page.locator(`#item-slots [data-item-slot="${reward.slot}"]`)).toHaveAttribute('data-item',reward.type);await expect(persistent).toHaveAttribute('data-persistent-mystery','false');await expect(persistent.locator('.destroy-ghost .persistent-loot')).toHaveCount(1);
  await speed(page,200);await page.locator('#pause-button').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:15000});await expect(persistent).toHaveAttribute('data-persistent-mystery','false');
  for(const [slot,type] of played.state.inventory.entries()){const item=page.locator(`#item-slots [data-item-slot="${slot}"]`);if(type)await expect(item).toHaveAttribute('data-item',type);else await expect(item).not.toHaveAttribute('data-item',/.+/);}
  await page.locator('#undo-button').click();await expect(persistent).toHaveAttribute('data-persistent-mystery','true');await expect(page.locator('#stage-number')).toHaveText('03');await expect(page.locator('#remaining-moves')).toHaveText(String(second.remainingMoves));await expect(page.locator('#score')).toHaveText(second.score.toLocaleString('en-US'));
  expect(await page.locator('#card-queue .queue-item').evaluateAll(cards=>cards.map(card=>card.dataset.sides))).toEqual(second.queue.slice(0,8).map(code));expect(errors).toEqual([]);
});
