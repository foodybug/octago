const {test,expect}=require('@playwright/test');
const E=require('../../engine.js');
const {withStartingMoves,enterGame}=require('./fixtures.cjs');
const createField=seed=>{const s=E.create(seed);return {...s,remainingMoves:50,board:s.board.map(({bonus,mystery,penalty,penaltyMode,...card})=>card)};};
const fmt=n=>n.toLocaleString('en-US');
const code=card=>card.sides.map(v=>v===null?'-':v?'1':'0').join('');
const queueCodes=page=>page.locator('#card-queue .queue-item').evaluateAll(items=>items.map(item=>item.dataset.sides));
function chainTrace(state,index){let s=E.begin(state,index);const events=[];while(s.status==='running'&&s.phase<E.PREVIEW_PHASE_LIMIT){s=E.step(s);events.push(s.lastEvent);}return {...s.chain,events,complete:s.status!=='running'};}
function result(index){let s=E.begin(createField('octago-001'),index);while(s.status==='running'&&s.phase<21)s=E.step(s);return s.status==='settling'?E.complete(s):null;}
const bestStart=Array.from({length:E.SIZE*E.SIZE},(_,i)=>({i,state:result(i)})).filter(({state})=>state&&state.phase<=20).sort((a,b)=>b.state.score-a.state.score)[0];
const isolated=Array.from({length:64},(_,i)=>i).find(i=>!E.connections(createField('octago-001'),i).length);
async function speed(page,value){await page.locator('#speed').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}
test.beforeEach(async({page})=>{await page.route('https://fonts.googleapis.com/**',r=>r.abort());await withStartingMoves(page,50,true);await page.goto('/');await enterGame(page);});

test('renders 8×8 with no central symbols and supports inspection',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('#board .card')).toHaveCount(64);await expect(page.locator('#board .card-center')).toHaveCount(0);await expect(page.locator('.col-labels span')).toHaveCount(8);await expect(page.locator('.row-labels span')).toHaveCount(8);
  await expect(page.locator('#board')).toHaveAttribute('aria-label','8행 8열 카드 필드');
  await expect(page.locator('#card-queue .queue-item')).toHaveCount(8);expect(await queueCodes(page)).toEqual(createField('octago-001').queue.slice(0,8).map(code));
  const fieldBox=await page.locator('.field-panel').boundingBox(),queueBox=await page.locator('.queue-panel').boundingBox();expect(queueBox.x).toBeGreaterThan(fieldBox.x+fieldBox.width);expect(Math.abs(queueBox.height-fieldBox.height)).toBeLessThan(1);
  const arrows=await page.locator('#board .card').evaluateAll(cards=>cards.map(c=>({
    count:c.querySelectorAll('.side-arrow').length,directions:[...c.querySelectorAll('.side-arrow')].map(a=>Number(a.style.getPropertyValue('--dir'))),
    out:c.querySelectorAll('.side-arrow.out').length,inward:c.querySelectorAll('.side-arrow.in').length,
    outColor:c.querySelector('.side-arrow.out')?getComputedStyle(c.querySelector('.side-arrow.out')).color:null,inColor:c.querySelector('.side-arrow.in')?getComputedStyle(c.querySelector('.side-arrow.in')).color:null,
    tone:c.classList.contains('tone-blue')?'blue':c.classList.contains('tone-yellow')?'yellow':'neutral',image:getComputedStyle(c).backgroundImage,surface:getComputedStyle(c).backgroundColor
  })));
  const expected=createField('octago-001').board;
  expect([...new Set(arrows.map(a=>a.count))].sort()).toEqual([...new Set(expected.map(c=>E.profile(c).total))].sort());
  for(const [i,a] of arrows.entries()){
    expect(a.count).toBeGreaterThanOrEqual(5);expect(a.count).toBeLessThanOrEqual(8);expect(a.out).toBeGreaterThanOrEqual(1);expect(a.inward).toBeGreaterThanOrEqual(1);expect(a.out+a.inward).toBe(a.count);
    expect(a.directions).toEqual(expected[i].sides.flatMap((v,d)=>v===null?[]:[d]));
    expect(a.outColor).toBe(a.out?'rgb(45, 85, 237)':null);expect(a.inColor).toBe(a.inward?'rgb(237, 141, 153)':null);expect(a.tone).toBe(a.out>a.inward?'blue':a.out<a.inward?'yellow':'neutral');expect(a.image).toBe('none');expect(a.surface).not.toBe('rgba(0, 0, 0, 0)');
  }
  const palette=new Map();
  for(const a of arrows){const ratio=a.out/a.count;if(palette.has(ratio))expect(a.surface).toBe(palette.get(ratio));else palette.set(ratio,a.surface);}
  expect(new Set(palette.values()).size).toBeGreaterThan(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('[data-index="36"]').focus();await expect(page.locator('#inspect-coordinate')).toHaveText('E5');await expect(page.locator('#inspect-preview .card-center')).toHaveCount(0);
  await page.locator('#game-screen h1').hover();
  await page.locator('#help-button').focus();await expect(page.locator('#chain-preview')).toBeHidden();
  await page.screenshot({path:info.outputPath('field-8x8.png'),fullPage:true});
  await page.locator('#help-button').click();await expect(page.locator('#help-dialog')).toBeVisible();await page.locator('#help-dialog [data-close]').click();expect(errors).toEqual([]);
});
test('complete chain matches one-hit engine scoring and undo restores the field',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await speed(page,200);
  const before=await page.locator('#board .card').evaluateAll(cards=>cards.map(c=>c.getAttribute('aria-label')));
  const beforeQueue=await queueCodes(page);
  await page.locator(`[data-index="${bestStart.i}"]`).click();await expect(page.locator('#board button:disabled')).toHaveCount(64);
  await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:20000});await expect(page.locator('#score')).toHaveText(fmt(bestStart.state.score));
  await expect(page.locator('#destroyed')).toHaveText(String(bestStart.state.destroyed).padStart(2,'0'));await expect(page.locator('#phase')).toHaveText(String(bestStart.state.phase).padStart(2,'0'));
  await expect(page.locator('#board .hole')).toHaveCount(0);await expect(page.locator('#board .card > .card-inner')).toHaveCount(64);await expect(page.locator('#board .card-center')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('completed-8x8.png'),fullPage:true});
  await page.locator('#undo-button').click();await expect(page.locator('#score')).toHaveText('0');await expect(page.locator('#moves')).toHaveText('00');
  expect(await page.locator('#board .card').evaluateAll(cards=>cards.map(c=>c.getAttribute('aria-label')))).toEqual(before);await expect(page.locator('#undo-button')).toBeDisabled();expect(errors).toEqual([]);
  expect(await queueCodes(page)).toEqual(beforeQueue);
});

test('queue cards replenish in row order with a stagger inside the current phase',async({page},info)=>{
  let simulation=E.begin(createField('octago-001'),bestStart.i);
  await speed(page,1200);await page.locator(`[data-index="${bestStart.i}"]`).click();await page.locator('#pause-button').click();
  while(true){
    const next=E.step(simulation);if(next.lastEvent.filled.length>=2&&next.lastEvent.filled.every(index=>!next.lastEvent.broken.includes(index)))break;
    await page.locator('#step-button').click();simulation=next;
  }
  expect(await queueCodes(page)).toEqual(simulation.queue.slice(0,8).map(code));
  const next=E.step(simulation),event=next.lastEvent;
  const destinations=await page.locator('#card-queue .queue-item').evaluateAll(items=>items.map(item=>({target:item.dataset.target,phase:item.dataset.spawnPhase})));
  event.filled.forEach((index,order)=>expect(destinations[order]).toEqual({target:String(index),phase:String(event.phase)}));
  await speed(page,200);await page.locator('#step-button').click();await expect(page.locator('#board')).toHaveAttribute('data-phase',String(event.phase));
  expect(await queueCodes(page)).toEqual(next.queue.slice(0,8).map(code));
  const filled=await page.locator('#board [data-spawn-order]').evaluateAll(cards=>cards.map(card=>({index:Number(card.dataset.index),order:Number(card.dataset.spawnOrder),delay:parseFloat(card.style.getPropertyValue('--spawn-delay')),sides:Array.from({length:8},(_,d)=>{const a=card.querySelector(`:scope > .card-inner .side-arrow[style="--dir:${d}"]`);return a?a.classList.contains('out')?'1':'0':'-';}).join('')})));
  expect(filled.map(card=>card.index)).toEqual(event.filled);
  filled.forEach((card,order)=>{expect(card.order).toBe(order+1);expect(card.sides).toBe(code(simulation.queue[order]));expect(card.delay+70).toBeLessThan(200);if(order)expect(card.delay).toBeGreaterThan(filled[order-1].delay);});
  const reveal=await page.locator('#board .just-filled').evaluateAll(cards=>cards.slice(0,2).map(card=>{const animation=card.getAnimations().find(a=>a.animationName==='fill');animation.pause();animation.currentTime=12;return getComputedStyle(card).filter;}));
  expect(reveal[0]).not.toBe('opacity(0)');expect(reveal[1]).toBe('opacity(0)');
  await page.locator('#board .just-filled').evaluateAll(cards=>cards.forEach(card=>card.getAnimations().forEach(a=>a.finish())));
  await page.screenshot({path:info.outputPath('queue-refill.png'),fullPage:true});
});
test('waiting cards slide up in sequence and preserve their place across control renders',async({page},info)=>{
  const initial=createField('octago-001');
  await speed(page,1200);await page.locator(`[data-index="${isolated}"]`).click();await page.locator('#pause-button').click();
  await page.locator('#step-button').click();await page.locator('#step-button').click();
  const survivor=await page.locator('#card-queue .queue-item').nth(1).elementHandle();
  const pitch=await page.locator('#card-queue .queue-item').evaluateAll(items=>items[1].getBoundingClientRect().top-items[0].getBoundingClientRect().top);
  await speed(page,200);await page.locator('#step-button').click();
  expect(await survivor.evaluate(node=>node===document.querySelector('#card-queue .queue-item'))).toBe(true);
  expect(await queueCodes(page)).toEqual(initial.queue.slice(1,9).map(code));await expect(page.locator('#card-queue .queue-item')).toHaveCount(8);
  const motion=await page.locator('#card-queue .queue-rising').evaluateAll(items=>items.map(node=>{
    const animation=node.getAnimations().find(a=>a.animationName==='queue-rise');if(!animation)throw Error('Queue card did not slide');
    animation.pause();const timing=animation.effect.getTiming(),duration=Number(timing.duration),delay=Number(timing.delay);
    const positions=[0,.5,1].map(progress=>{animation.currentTime=delay+duration*progress;return new DOMMatrix(getComputedStyle(node).transform).f;});
    return {delay,duration,positions};
  }));
  expect(motion.length).toBeGreaterThanOrEqual(6);expect(motion[0].positions[0]).toBeCloseTo(pitch,0);
  motion.forEach((row,index)=>{expect(row.positions[0]).toBeGreaterThan(0);expect(row.positions[1]).toBeLessThan(row.positions[0]);expect(row.positions[1]).toBeGreaterThan(0);expect(row.positions[2]).toBeCloseTo(0,4);expect(row.delay+row.duration).toBeLessThan(200);if(index)expect(row.delay).toBeGreaterThan(motion[index-1].delay);});
  await page.locator('#card-queue .queue-rising').evaluateAll(items=>items.forEach(node=>{node.getAnimations().find(a=>a.animationName==='queue-rise').currentTime=70;}));
  await page.screenshot({path:info.outputPath('queue-conveyor.png'),fullPage:true});
  await page.locator('#help-button').click();expect(await survivor.evaluate(node=>node===document.querySelector('#card-queue .queue-item'))).toBe(true);
  expect(await survivor.evaluate(node=>node.getAnimations().find(a=>a.animationName==='queue-rise').currentTime)).toBe(70);
  await page.locator('#help-dialog [data-close]').click();await page.emulateMedia({reducedMotion:'reduce'});
  expect(await page.locator('#card-queue .queue-item').evaluateAll(items=>items.every(node=>getComputedStyle(node).transform==='none'))).toBe(true);
  expect(await queueCodes(page)).toEqual(initial.queue.slice(1,9).map(code));
});
test('pause and stepping lock input and do not run phases in the background',async({page})=>{
  await speed(page,1200);await page.locator(`[data-index="${bestStart.i}"]`).click();await page.locator('#pause-button').click();
  const phase=await page.locator('#board').getAttribute('data-phase');await page.waitForTimeout(1400);await expect(page.locator('#board')).toHaveAttribute('data-phase',phase);
  await page.locator('#step-button').click();await expect(page.locator('#board')).toHaveAttribute('data-phase',String(Number(phase)+1));await expect(page.locator('#board button:disabled')).toHaveCount(64);
  await page.locator('#help-button').click();await page.locator('#help-dialog [data-close]').click();await expect(page.locator('#field-state')).toHaveText('PAUSED');
  await speed(page,200);await page.locator('#pause-button').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:20000});
});
test('seed restart and keyboard navigation use eight columns',async({page})=>{
  const original=await page.locator('[data-index="36"]').getAttribute('aria-label');
  await page.locator('#new-button').click();await page.locator('#seed-input').fill('34');await page.locator('#start-button').click();
  const generatedCounts=await page.locator('#board .card, #card-queue .card').evaluateAll(cards=>cards.map(card=>card.querySelectorAll('.side-arrow').length));
  expect(generatedCounts.every(count=>count>=5&&count<=8)).toBe(true);
  expect(await page.locator('#board .card, #card-queue .card').evaluateAll(cards=>cards.every(card=>card.querySelector('.side-arrow.in')&&card.querySelector('.side-arrow.out')))).toBe(true);
  expect(await page.locator('[data-index="36"]').getAttribute('aria-label')).not.toEqual(original);
  await page.locator('#new-button').click();await page.locator('#seed-input').fill('octago-001');await page.locator('#seed-input').press('Enter');
  await expect(page.locator('[data-index="36"]')).toHaveAttribute('aria-label',original);
  await page.locator('[data-index="36"]').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('[data-index="37"]')).toBeFocused();await page.keyboard.press('ArrowDown');await expect(page.locator('[data-index="45"]')).toBeFocused();
  await speed(page,200);await page.keyboard.press('Enter');await expect(page.locator('#moves')).toHaveText('01');
  await speed(page,300);await page.reload();await enterGame(page);await expect(page.locator('#speed')).toHaveValue('300');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('hover highlights current-card chains without fading cards or adding order numbers',async({page},info)=>{
  const trace=E.preview(createField('octago-001'),bestStart.i),before=await page.locator('#board .card').evaluateAll(cards=>cards.map(c=>c.innerHTML));
  const opacity=await page.locator('#board .card, #board .card-inner, #board .side-arrow').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).opacity));
  await page.locator(`[data-index="${bestStart.i}"]`).hover();await expect(page.locator('#board .preview-hit')).toHaveCount(trace.cards.length);await expect(page.locator('#board .preview-destroyed')).toHaveCount(trace.cards.length);
  expect(await page.locator('#board .card, #board .card-inner, #board .side-arrow').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).opacity))).toEqual(opacity);
  await expect(page.locator('#board .preview-phase, #board [data-preview-phases]')).toHaveCount(0);
  await expect(page.locator('#links line, #links path, #links .signal-flight')).toHaveCount(0);expect(await page.locator('#board .side-arrow.preview-link').count()).toBeGreaterThan(0);
  for(const link of trace.events[0].links){await expect(page.locator(`[data-index="${link.from}"] > .card-inner .side-arrow[data-direction="${link.direction}"]`)).toHaveClass(/preview-out/);await expect(page.locator(`[data-index="${link.to}"] > .card-inner .side-arrow[data-direction="${(link.direction+4)%8}"]`)).toHaveClass(/preview-in/);}
  await expect(page.locator('#preview-score')).toHaveText('+'+fmt(trace.points));await expect(page.locator('#preview-phases')).toHaveText(String(trace.phases));await expect(page.locator('#score')).toHaveText('0');
  await page.screenshot({path:info.outputPath('chain-preview-8x8.png'),fullPage:true});
  await page.locator('#game-screen h1').hover();await expect(page.locator('#chain-preview')).toBeHidden();await expect(page.locator('#board .side-arrow.preview-link')).toHaveCount(0);await expect(page.locator('#links line')).toHaveCount(0);
  expect(await page.locator('#board .card').evaluateAll(cards=>cards.map(c=>c.innerHTML))).toEqual(before);
});
test('preview arrows stay white without animation while unrelated arrows stay unchanged',async({page},info)=>{
  for(const preference of ['no-preference','reduce']){
    await page.emulateMedia({reducedMotion:preference});await page.locator('[data-index="10"]').hover();
    const unrelated=page.locator('#board .side-arrow:not(.preview-link) polygon');
    const read=elements=>elements.map(el=>{const s=getComputedStyle(el);return [s.fill,s.stroke,s.filter,s.opacity];});
    const before=await unrelated.evaluateAll(read);
    for(const role of ['out','in']){
      const style=await page.locator(`#board .preview-${role} polygon`).first().evaluate(el=>{
        const s=getComputedStyle(el);return {fill:s.fill,stroke:s.stroke,color:s.color,opacity:s.opacity,animations:el.getAnimations().length};
      });
      expect(style.fill).toBe('rgb(255, 255, 255)');expect(style.stroke).toBe(style.color);expect(style.opacity).toBe('1');expect(style.animations).toBe(0);
    }
    if(preference==='no-preference'){
      await page.screenshot({path:info.outputPath('preview-white.png'),fullPage:true});
    }
    expect(await unrelated.evaluateAll(read)).toEqual(before);await expect(page.locator('#score')).toHaveText('0');
    await page.locator('#game-screen h1').hover();await expect(page.locator('#board .preview-link')).toHaveCount(0);
    await expect(page.locator('#board .side-arrow.out polygon').first()).toHaveCSS('fill','rgb(45, 85, 237)');
    await expect(page.locator('#board .side-arrow.in polygon').first()).toHaveCSS('fill','rgb(237, 141, 153)');
  }
});
test('forecasts recompute from the current cards after a played chain',async({page})=>{
  await speed(page,200);await page.locator(`[data-index="${bestStart.i}"]`).click();await expect(page.locator('#chain-preview')).toBeHidden();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:20000});
  const inspectIndex=bestStart.state.board.findIndex(card=>!E.isSpecial(card));await page.locator('#game-screen h1').hover();await page.locator(`[data-index="${inspectIndex}"]`).hover();const trace=E.preview(bestStart.state,inspectIndex);await expect(page.locator('#preview-score')).toHaveText('+'+fmt(trace.points));
  const next=Array.from({length:64},(_,i)=>i).filter(i=>!E.isSpecial(bestStart.state.board[i])).map(i=>({i,p:E.preview(bestStart.state,i),played:chainTrace(bestStart.state,i)})).filter(({played})=>played.complete&&played.phases<=20).sort((a,b)=>b.p.points-a.p.points)[0];
  await page.locator(`[data-index="${next.i}"]`).hover();await expect(page.locator('#preview-score')).toHaveText('+'+fmt(next.p.points));
  await page.locator(`[data-index="${next.i}"]`).click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle',{timeout:20000});await expect(page.locator('#score')).toHaveText(fmt(bestStart.state.score+next.played.points));
});
test('preview excludes cards reached only through replacement cards',async({page})=>{
  const initial=createField('0'),trace=E.preview(initial,4),played=chainTrace(initial,4),current=new Set(trace.cards.map(card=>card.index));
  const futureOnly=[...new Set(played.events.flatMap(event=>event.active))].filter(index=>!current.has(index));expect(futureOnly.length).toBeGreaterThan(0);
  await page.locator('#new-button').click();await page.locator('#seed-input').fill('0');await page.locator('#start-button').click();await page.locator('#game-screen h1').hover();
  await page.locator('#board').evaluate(board=>Promise.all(board.getAnimations({subtree:true}).filter(animation=>animation instanceof CSSTransition).map(animation=>animation.finished)));
  const queue=await queueCodes(page);
  const unchanged=await page.locator('#board .card').evaluateAll((cards,indices)=>indices.map(index=>{const el=cards[index],s=getComputedStyle(el);return [el.innerHTML,s.backgroundColor,s.borderColor,s.boxShadow,s.opacity];}),futureOnly);
  await page.locator('[data-index="4"]').hover();
  expect(await page.locator('#board .preview-hit').evaluateAll(cards=>cards.map(card=>Number(card.dataset.index)).sort((a,b)=>a-b))).toEqual([...current].sort((a,b)=>a-b));
  for(const index of futureOnly)await expect(page.locator(`[data-index="${index}"] .preview-link`)).toHaveCount(0);
  expect(await page.locator('#board .card').evaluateAll((cards,indices)=>indices.map(index=>{const el=cards[index],s=getComputedStyle(el);return [el.innerHTML,s.backgroundColor,s.borderColor,s.boxShadow,s.opacity];}),futureOnly)).toEqual(unchanged);
  await expect(page.locator('#preview-score')).toHaveText('+'+fmt(trace.points));await expect(page.locator('#preview-cards')).toHaveText(String(current.size));await expect(page.locator('#board .preview-phase')).toHaveCount(0);expect(await queueCodes(page)).toEqual(queue);
});
test('destruction scatters fluttering fragments, waits one phase, then replenishes',async({page},info)=>{
  const initial=createField('octago-001'),p3=E.step(E.step(E.step(E.begin(initial,isolated)))),source=page.locator(`[data-index="${isolated}"]`);
  await speed(page,1200);await source.click();await page.locator('#pause-button').click();await page.locator('#step-button').click();
  const popup=page.locator(`.score-popup[data-card-index="${isolated}"] .destroy-points`);
  await expect(page.locator('#board')).toHaveAttribute('data-phase','1');await expect(source).toHaveAttribute('data-respawn-in','2');await expect(source).toHaveClass(/shattering/);
  await expect(source.locator(':scope > .card-inner')).toHaveCount(0);await expect(source.locator('.destroy-fx')).toHaveCount(1);await expect(source.locator('.destroy-shard')).toHaveCount(8);expect(await source.locator('.destroy-flake').count()).toBeGreaterThan(0);await expect(source.locator('.destroy-flake').first()).toHaveCSS('animation-name','destroy-flake');
  await expect(popup).toHaveText('+100');await expect(popup).toBeVisible();await expect(page.locator('#score')).toHaveText('100');expect(await queueCodes(page)).toEqual(initial.queue.slice(0,8).map(code));
  await page.screenshot({path:info.outputPath('destruction-effect.png'),fullPage:true});
  await expect(page.locator('#board')).not.toHaveAttribute('data-hit-stop');
  await source.locator('.destroy-fx').evaluate(el=>el.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)*.4;}));
  await page.screenshot({path:info.outputPath('flutter-fragments.png'),fullPage:true});
  await page.locator('#step-button').click();await expect(source).toHaveAttribute('data-respawn-in','1');await expect(source.locator(':scope > .card-inner')).toHaveCount(0);await expect(source.locator('.destroy-fx')).toHaveCount(0);await expect(page.locator('#score')).toHaveText('100');
  await page.locator('#step-button').click();await expect(source).not.toHaveAttribute('data-respawn-in');const regeneratedCount=await source.locator(':scope > .card-inner .side-arrow').count();expect(regeneratedCount).toBeGreaterThanOrEqual(5);expect(regeneratedCount).toBeLessThanOrEqual(8);expect(await queueCodes(page)).toEqual(p3.queue.slice(0,8).map(code));
  await page.locator('#step-button').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#board')).toHaveAttribute('data-phase','3');await expect(page.locator('#board .card > .card-inner')).toHaveCount(64);await expect(popup).toHaveCount(0);
});
test('scores trigger exactly 100ms of hit stop before the normal phase interval',async({page})=>{
  await page.clock.install({time:new Date('2026-11-03T00:00:00Z')});await page.clock.pauseAt('2026-11-03T00:00:01Z');
  await speed(page,200);await page.locator(`[data-index="${isolated}"]`).click();
  await page.clock.runFor(200);await expect(page.locator('#board')).toHaveAttribute('data-phase','1');
  const popup=page.locator(`.score-popup[data-card-index="${isolated}"] .destroy-points`);await expect(popup).toHaveText('+100');await expect(popup).toHaveCSS('animation-duration','0.9s');
  await expect(page.locator('#board')).toHaveAttribute('data-hit-stop','true');await expect(page.locator('#board .destroy-shard').first()).toHaveCSS('animation-play-state','paused');await expect(popup).toHaveCSS('animation-play-state','running');await expect(page.locator('#step-button')).toBeDisabled();
  await expect(page.locator('#board .destroy-fx')).toBeVisible();
  await page.clock.runFor(99);await expect(page.locator('#board')).toHaveAttribute('data-hit-stop','true');await expect(page.locator('#board')).toHaveAttribute('data-phase','1');
  await page.clock.runFor(1);await expect(page.locator('#board')).not.toHaveAttribute('data-hit-stop');await expect(page.locator('#board .destroy-shard').first()).toHaveCSS('animation-play-state','running');await expect(page.locator('#step-button')).toBeEnabled();
  await page.clock.runFor(199);await expect(page.locator('#board')).toHaveAttribute('data-phase','1');
  await page.clock.runFor(1);await expect(page.locator('#board')).toHaveAttribute('data-phase','2');await expect(page.locator('#board')).not.toHaveAttribute('data-hit-stop');
  await page.clock.runFor(400);await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#board')).toHaveAttribute('data-phase','3');
  await expect(popup).toHaveCount(1);await page.clock.runFor(199);await expect(popup).toHaveCount(1);
  await page.clock.runFor(1);await expect(popup).toHaveCount(0);
});

test('simultaneous scoring stops once and hit stop never releases a manual pause',async({page})=>{
  const initial=createField('octago-001'),source=Array.from({length:64},(_,i)=>i).find(i=>{const p1=E.step(E.begin(initial,i));return p1.frontier.length>1&&E.step(p1).frontier.length>0;});
  await page.clock.install({time:new Date('2026-11-03T00:00:00Z')});await page.clock.pauseAt('2026-11-03T00:00:01Z');
  await speed(page,200);await page.locator(`[data-index="${source}"]`).click();await page.clock.runFor(200);
  await expect(page.locator('#links .signal-flight').first()).toHaveCSS('animation-play-state','paused');
  await page.clock.runFor(100);await expect(page.locator('#board')).not.toHaveAttribute('data-hit-stop');
  await expect(page.locator('#links .signal-flight').first()).toHaveCSS('animation-play-state','running');
  await page.clock.runFor(200);await expect(page.locator('#board')).toHaveAttribute('data-phase','2');expect(await page.locator('#board .destroy-fx').count()).toBeGreaterThan(1);
  await expect(page.locator('#board')).toHaveAttribute('data-hit-stop','true');await page.locator('#pause-button').click();
  await page.clock.runFor(99);await expect(page.locator('#board')).toHaveAttribute('data-hit-stop','true');
  await page.clock.runFor(1);await expect(page.locator('#board')).not.toHaveAttribute('data-hit-stop');await expect(page.locator('#pause-button')).toHaveAttribute('aria-pressed','true');
  await page.clock.runFor(1000);await expect(page.locator('#board')).toHaveAttribute('data-phase','2');await expect(page.locator('#field-state')).toHaveText('PAUSED');
  await page.locator('#step-button').click();await expect(page.locator('#board')).toHaveAttribute('data-phase','3');
});
test('due replacements can activate on arrival while destruction effects intensify',async({page},info)=>{
  const trace=chainTrace(createField('0'),8);await page.locator('#new-button').click();await page.locator('#seed-input').fill('0');await page.locator('#start-button').click();
  await speed(page,1200);await page.locator('[data-index="8"]').click();await page.locator('#pause-button').click();let captured=false,deepCaptured=false,firstEffect,lastEffect;
  for(const [eventIndex,event] of trace.events.entries()){
    await page.locator('#step-button').click();await expect(page.locator('#board')).toHaveAttribute('data-phase',String(event.phase));await expect(page.locator('#board .destroy-fx')).toHaveCount(event.broken.length);
    await expect(page.locator(`.score-popup[data-phase="${event.phase}"] .destroy-points`)).toHaveText(event.broken.map(()=>`+${fmt(event.perCard)}`));
    if(event.broken.length){
      const effect=await page.locator('#board .destroy-fx').first().evaluate(el=>({particles:el.querySelectorAll('.destroy-shard').length,rings:el.querySelectorAll('.destroy-ring').length,rays:el.querySelectorAll('.destroy-ray').length,glow:parseFloat(el.style.getPropertyValue('--fx-glow'))}));
      firstEffect||=effect;lastEffect=effect;
      if(event.phase===1)await page.screenshot({path:info.outputPath('early-destruction.png'),fullPage:true});
      if(event.phase>=5&&!deepCaptured){await page.screenshot({path:info.outputPath('deep-destruction.png'),fullPage:true});deepCaptured=true;}
    }
    const born=event.filled.filter(i=>event.active.includes(i));for(const i of born)await expect(page.locator(`[data-index="${i}"]`)).toHaveClass(/shattering/);
    await expect(page.locator('#board .just-filled')).toHaveCount(event.filled.filter(i=>!event.broken.includes(i)).length);
    if(born.length&&!captured){await page.screenshot({path:info.outputPath('regenerated-destruction.png'),fullPage:true});captured=true;}
  }
  expect(lastEffect.particles).toBeGreaterThan(firstEffect.particles);expect(lastEffect.rings).toBeGreaterThan(firstEffect.rings);expect(lastEffect.rays).toBeGreaterThan(firstEffect.rays);expect(lastEffect.glow).toBeGreaterThan(firstEffect.glow);
  expect(captured).toBe(true);expect(deepCaptured).toBe(true);await page.locator('#step-button').click();await expect(page.locator('#board')).toHaveAttribute('data-status','idle');await expect(page.locator('#score')).toHaveText(fmt(trace.points));
});
test('reduced motion hides particles and retains the destruction marker and score',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await speed(page,1200);const source=page.locator(`[data-index="${isolated}"]`);await source.click();await page.locator('#pause-button').click();await page.locator('#step-button').click();
  await expect(source.locator('.destroy-fx')).toBeHidden();await expect(source.locator('.broken-mark')).toBeVisible();await expect(source.locator(':scope > .card-inner')).toHaveCount(0);await expect(page.locator('.score-popup .destroy-points')).toHaveText('+100');await expect(page.locator('.score-popup .destroy-points')).toBeVisible();await expect(page.locator('.score-popup .destroy-points')).toHaveCSS('animation-name','none');await expect(page.locator('#score')).toHaveText('100');
});

test('blast radius and fragments keep growing after phase nine',async({page},info)=>{
  const trace=chainTrace(createField('0'),6),effects=new Map();
  await page.locator('#new-button').click();await page.locator('#seed-input').fill('0');await page.locator('#start-button').click();
  await speed(page,1200);await page.locator('[data-index="6"]').click();await page.locator('#pause-button').click();
  for(const event of trace.events.filter(event=>event.phase<=10)){
    await page.locator('#step-button').click();await expect(page.locator('#board')).toHaveAttribute('data-phase',String(event.phase));
    if(event.broken.length){
      const effect=await page.locator('#board .destroy-fx').first().evaluate(el=>({
        radius:parseFloat(el.style.getPropertyValue('--ring-end')),size:parseFloat(el.style.getPropertyValue('--shard-size')),
        reach:Math.max(...[...el.querySelectorAll('.destroy-shard')].map(shard=>Math.hypot(parseFloat(shard.style.getPropertyValue('--dx')),parseFloat(shard.style.getPropertyValue('--dy')))))/el.parentElement.clientWidth
      }));
      effects.set(event.phase,effect);
      if(event.phase===1)await page.screenshot({path:info.outputPath('blast-phase-01.png'),fullPage:true});
      if(event.phase===10){await expect(page.locator('#board')).not.toHaveAttribute('data-hit-stop');await page.waitForTimeout(180);await page.screenshot({path:info.outputPath('blast-phase-10.png'),fullPage:true});}
    }
  }
  for(const key of ['radius','reach','size']){
    expect(effects.get(5)[key]).toBeGreaterThan(effects.get(1)[key]);
    expect(effects.get(9)[key]).toBeGreaterThan(effects.get(5)[key]);
    expect(effects.get(10)[key]).toBeGreaterThan(effects.get(9)[key]);
  }
});
test('the following chain wave has a pale purple border and advances into the next wave',async({page},info)=>{
  const p1=E.step(E.begin(createField('octago-001'),10)),p2=E.step(p1),following=p2.frontier.filter(index=>p1.board[index]);
  expect(following.length).toBeGreaterThan(0);
  await speed(page,1200);await page.locator('[data-index="10"]').click();await page.locator('#pause-button').click();await page.locator('#step-button').click();
  const indices=selector=>page.locator(selector).evaluateAll(cards=>cards.map(card=>Number(card.dataset.index)).sort((a,b)=>a-b));
  expect(await indices('#board .queued')).toEqual(p1.frontier);
  expect(await indices('#board .queued-later')).toEqual(following);
  await expect(page.locator('#board .queued.queued-later')).toHaveCount(0);await expect(page.locator('#board .hole.queued-later, #board .broken.queued-later')).toHaveCount(0);
  await expect(page.locator('#board .preview-phase')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('following-chain-wave.png'),fullPage:true});
  await page.locator('#step-button').click();expect(await indices('#board .queued')).toEqual(p2.frontier);await expect(page.locator('#score')).toHaveText(fmt(p2.score));
  for(const index of following){await expect(page.locator(`[data-index="${index}"]`)).toHaveClass(/queued/);await expect(page.locator(`[data-index="${index}"]`)).not.toHaveClass(/queued-later/);}
  await page.locator('#new-button').click();await page.locator('#start-button').click();await expect(page.locator('#board .queued, #board .queued-later')).toHaveCount(0);
});
test('a diagonal connection previews and activates the correct opposite-facing neighbor',async({page},info)=>{
  const candidate=Array.from({length:64},(_,i)=>({i,p:E.preview(createField('octago-001'),i)})).find(({p})=>p.events[0].links.some(l=>l.direction%2===1));
  const link=candidate.p.events[0].links.find(l=>l.direction%2===1);
  await page.locator(`[data-index="${candidate.i}"]`).hover();
  await expect(page.locator('#links line, #links path')).toHaveCount(0);
  await expect(page.locator(`[data-index="${candidate.i}"] > .card-inner .side-arrow[data-direction="${link.direction}"]`)).toHaveClass(/preview-out/);
  await expect(page.locator(`[data-index="${link.to}"] > .card-inner .side-arrow[data-direction="${(link.direction+4)%8}"]`)).toHaveClass(/preview-in/);
  await speed(page,1200);await page.locator(`[data-index="${candidate.i}"]`).click();await page.locator('#pause-button').click();
  await page.locator('#step-button').click();await expect(page.locator(`[data-index="${link.to}"]`)).toHaveClass(/queued/);
  await expect(page.locator(`[data-index="${link.to}"] > .card-inner .side-arrow[data-direction="${(link.direction+4)%8}"]`)).toHaveClass(/chain-in/);
  const flight=page.locator(`#links .signal-flight[data-from="${candidate.i}"][data-to="${link.to}"]`);await expect(flight).toHaveCount(1);
  const positions=await flight.evaluate(el=>{const animation=el.getAnimations().find(animation=>animation.animationName==='signal-travel'),duration=Number(animation.effect.getTiming().duration);animation.pause();return [0,.5,1].map(t=>{animation.currentTime=duration*t;const m=new DOMMatrix(getComputedStyle(el).transform);return [m.e,m.f];});});
  expect(Math.hypot(positions[1][0]-positions[0][0],positions[1][1]-positions[0][1])).toBeGreaterThan(1);expect(Math.hypot(positions[2][0]-positions[0][0],positions[2][1]-positions[0][1])).toBeGreaterThan(3);
  await page.locator('#links .signal-flight').evaluateAll(elements=>elements.forEach(el=>{const animation=el.getAnimations().find(animation=>animation.animationName==='signal-travel');animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)*.45;}));
  await page.screenshot({path:info.outputPath('chain-signal-flight.png'),fullPage:true});
  await page.locator('#step-button').click();await expect(page.locator(`[data-index="${link.to}"]`)).toHaveClass(/shattering/);
});
