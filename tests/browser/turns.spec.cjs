const {test,expect}=require('@playwright/test');
const E=require('../../engine.js');
const {withStartingMoves,withStartingStage,enterGame}=require('./fixtures.cjs');
const types=['bonus','mystery','penalty'];
function finish(state,index){let s=E.begin(state,index);while(s.status==='running'&&s.phase<512)s=E.step(s);return s.status==='settling'?E.complete(s):null;}
function chain(state,index){let s=E.begin(state,index);const phases=[];while(s.status==='running'&&s.phase<512){s=E.step(s);phases.push(s);}return s.status==='settling'?{state:E.complete(s),phases}:null;}
function quietCard(s){const i=s.board.findIndex((card,i)=>types.every(type=>!card[type])&&E.connections(s,i).length===0);if(i<0)throw Error('No quiet card');return i;}
async function speed(page,value){await page.locator('#speed').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function play(page,index,status='idle'){await page.locator(`#board > [data-index="${index}"]`).click();await expect(page.locator('#board')).toHaveAttribute('data-status',status,{timeout:15000});}
async function expectSpecials(page,state){
  for(const type of types){const expected=state.board.flatMap((card,i)=>card?.[type]&&!card.persistentMystery?[i]:[]),cards=page.locator(`#board > [data-${type}="true"]:not([data-persistent-mystery="true"])`);await expect(cards).toHaveCount(expected.length);expect(await cards.evaluateAll(cards=>cards.map(card=>Number(card.dataset.index)))).toEqual(expected);await expect(page.locator(`#special-${type}-count`)).toHaveText(String(expected.length));}
  await expect(page.locator('#persistent-mystery-count')).toHaveText(String(state.board.filter(card=>card?.persistentMystery).length));
}

test.beforeEach(async({page})=>{await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('/');await enterGame(page);await speed(page,200);});

test('the first stage displays three plus cards, one mystery, and two minus cards',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));const s=E.create('octago-001');
  await expectSpecials(page,s);await expect(page.locator('#stage-number')).toHaveText('01');await expect(page.locator('#difficulty-level')).toHaveText('1 / 20');await expect(page.locator('#remaining-moves')).toHaveText('3');
  await expect(page.locator('#board > .card > .card-inner .card-bonus')).toHaveText(['+1','+1','+1']);await expect(page.locator('#board > .card > .card-inner .card-penalty')).toHaveText(['−1','−1']);
  await expect(page.locator('#board > [data-penalty-mode="random"]')).toHaveCount(1);await expect(page.locator('#board > [data-penalty-mode="difficulty"]')).toHaveCount(1);
  const minus=page.locator('#board > [data-penalty="true"]').first();await minus.hover();await expect(page.locator('#inspect-detail')).toContainText('−1 발동 횟수 감소');await expect(minus).toHaveAttribute('aria-label',/남은 횟수 −1/);
  await page.locator('#game-screen h1').hover();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('stage-one-specials.png'),fullPage:true});expect(errors).toEqual([]);
});

test('special cards show locks and reject clicks, taps, Enter and Space without spending a move',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));const cards=page.locator('#board > .chain-only');await expect(cards).toHaveCount(6);await expect(cards.locator(':scope > .card-inner .special-lock')).toHaveCount(6);
  for(const card of await cards.all()){
    await expect(card).toBeDisabled();await expect(card).toHaveAttribute('aria-describedby','special-card-rule');await expect(card).toHaveCSS('border-top-style','dashed');
    if(info.project.name==='mobile')await card.tap({force:true});else await card.click({force:true});
    await card.focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');
  }
  await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#remaining-moves')).toHaveText('3');await expect(page.locator('#moves')).toHaveText('00');await expect(page.locator('#score')).toHaveText('0');await expect(page.locator('#undo-button')).toBeDisabled();
  await expect(page.locator('#chain-preview')).toBeHidden();await expect(page.locator('#inspect-detail')).toContainText('연쇄 전용 · 직접 선택 불가');await expect(page.locator('#board .preview-hit')).toHaveCount(0);expect(errors).toEqual([]);
  await page.locator('#game-screen h1').hover();await page.screenshot({path:info.outputPath('chain-only-specials.png'),fullPage:true});
});

test('all six specials relocate after every stage even when none were activated',async({page},info)=>{
  await withStartingMoves(page,10);await page.reload();await enterGame(page);await speed(page,200);let s={...E.create('octago-001'),remainingMoves:10};
  for(let turn=1;turn<=3;turn++){
    const source=quietCard(s),before=s;
    expect(source).toBeGreaterThanOrEqual(0);s=finish(s,source);expect(s).toBeTruthy();await play(page,source,s.status);await expectSpecials(page,s);
    for(const type of types)for(const [i,card] of before.board.entries())if(card[type]&&!card.persistentMystery)await expect(page.locator(`#board > [data-index="${i}"]`)).toHaveAttribute('data-'+type,'false');
    await expect(page.locator('#board > [data-penalty-mode="random"]')).toHaveCount(1);await expect(page.locator('#board > [data-penalty-mode="difficulty"]')).toHaveCount(1);
    await expect(page.locator('#stage-number')).toHaveText(String(turn+1).padStart(2,'0'));await expect(page.locator('#difficulty-level')).toHaveText(`${turn+1} / 20`);await expect(page.locator('#remaining-moves')).toHaveText(String(s.remainingMoves));
    expect(s.lastEvent.markersAdded.length).toBe(6);await expect(page.locator('.toast')).toHaveText('+1 3장 재배치 · ? 1장 재배치 · −1 2장 재배치');
  }
  await page.locator('#game-screen h1').hover();await page.screenshot({path:info.outputPath('persistent-specials.png'),fullPage:true});
});

test('minus cards show a loss, finish the chain before game over, and undo restores all markers',async({page},info)=>{
  await withStartingMoves(page,1);await page.reload();await enterGame(page);await speed(page,1200);const initial={...E.create('octago-001'),remainingMoves:1};
  const played=chain(initial,60),candidate={index:60,state:played.state},loss=played.phases.find(s=>s.lastEvent.penaltyEffects.length);expect(candidate.state.status).toBe('gameover');
  await page.locator(`#board > [data-index="${candidate.index}"]`).click();await page.locator('#pause-button').click();for(let phase=1;phase<=loss.phase;phase++)await page.locator('#step-button').click();
  await expect(page.locator('#remaining-moves')).toHaveText(String(loss.remainingMoves));await expect(page.locator('.penalty-points').first()).toHaveText('−1회');await expect(page.locator('#gameover-overlay')).toBeHidden();await expect(page.locator('#score')).toHaveText(loss.score.toLocaleString('en-US'));
  await page.screenshot({path:info.outputPath('minus-card-loss.png'),fullPage:true});
  await speed(page,200);await page.locator('#pause-button').click();await expect(page.locator('#board')).toHaveAttribute('data-status','gameover',{timeout:15000});await expectSpecials(page,candidate.state);
  await expect(page.locator('#remaining-moves')).toHaveText('0');await expect(page.locator('#gameover-overlay')).toBeVisible();await expect(page.locator('#board > button:disabled')).toHaveCount(64);await expect(page.locator('#pause-button')).toBeDisabled();
  await page.locator('#undo-gameover').click();await expect(page.locator('#gameover-overlay')).toBeHidden();await expect(page.locator('#remaining-moves')).toHaveText('1');await expectSpecials(page,initial);await expect(page.locator('#stage-number')).toHaveText('01');
  await page.locator('#new-button').click();await page.locator('#start-button').click();await expect(page.locator('#remaining-moves')).toHaveText('1');
  for(const [type,count] of [['bonus',3],['mystery',1],['penalty',2]])await expect(page.locator(`#board > [data-${type}="true"]`)).toHaveCount(count);await expect(page.locator('#item-capacity')).toHaveText('0 / 3');
});

test('a last-move plus card rescues the game and is replaced for the next stage',async({page},info)=>{
  await withStartingMoves(page,1);await page.reload();await enterGame(page);await speed(page,1200);const initial={...E.create('octago-001'),remainingMoves:1};
  const played=chain(initial,6),candidate={index:6,state:played.state},gain=played.phases.find(s=>s.lastEvent.bonusRewards.length);expect(candidate.state.status).toBe('idle');
  await page.locator(`#board > [data-index="${candidate.index}"]`).click();await expect(page.locator('#remaining-moves')).toHaveText('0');await page.locator('#pause-button').click();for(let phase=1;phase<=gain.phase;phase++)await page.locator('#step-button').click();
  await expect(page.locator('#remaining-moves')).toHaveText('1');await expect(page.locator('.bonus-points')).toHaveText('+1회');await expect(page.locator('#gameover-overlay')).toBeHidden();
  await speed(page,200);await page.locator('#pause-button').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:15000});await expectSpecials(page,candidate.state);await expect(page.locator('#stage-number')).toHaveText('02');
});

test('late stages display maximum placement difficulty and preserve the mobile layout',async({page},info)=>{
  await withStartingStage(page,20);await page.reload();await enterGame(page);const base=E.create('octago-001'),board=base.board.map(({mystery,bonus,penalty,penaltyMode,...card})=>card),expected=E.complete({...base,board,moves:19,status:'settling'});
  await expectSpecials(page,expected);await expect(page.locator('#stage-number')).toHaveText('20');await expect(page.locator('#difficulty-level')).toHaveText('20 / 20');await expect(page.locator('#stage-summary')).toHaveAttribute('data-difficulty','1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#game-screen h1').hover();await page.screenshot({path:info.outputPath('stage-twenty-specials.png'),fullPage:true});
});
