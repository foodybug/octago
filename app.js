(() => {
  'use strict';
  const $ = id => document.getElementById(id), E = Octago, L = OctagoLobby, P = OctagoPlatform;
  const number = value => value.toLocaleString('en-US');
  const SCORE_POPUP_MS = 900;
  const HIT_STOP_MS = 100;
  function appearance(card) {
    const profile = E.profile(card);
    const ratio = profile.total ? profile.out/profile.total : .5;
    const neutral = [248,250,253], target = ratio >= .5 ? [174,202,255] : [255,228,142];
    const strength = Math.abs(ratio - .5) * 2;
    const surface = `rgb(${neutral.map((channel,i)=>Math.round(channel+(target[i]-channel)*strength)).join(', ')})`;
    return { ...profile, ratio, surface, class: 'tone-' + profile.tone, name: profile.tone === 'blue' ? '바깥 우세 · 파란 색조' : profile.tone === 'yellow' ? '안쪽 우세 · 노란 색조' : `${profile.out} : ${profile.inward} 균형` };
  }
  const arrow = '<svg viewBox="0 0 24 12" aria-hidden="true"><polygon points="12,1 23,11 1,11"/></svg>';
  const ITEMS = {
    row:{name:'가로줄',detail:'같은 가로줄 전체 발동',icon:'<path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4"/>'},
    column:{name:'세로줄',detail:'같은 세로줄 전체 발동',icon:'<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'},
    adjacent:{name:'주변 8칸',detail:'대각선을 포함한 인접 카드 전체 발동',icon:'<rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/><path d="M4 4h2m4 0h4m4 0h2M4 10v4m16-4v4M4 20h2m4 0h4m4 0h2"/>'}
  };
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem('octago-chain-v1') || '{}') || {}; } catch {}
  let best = Number.isSafeInteger(preferences.best) && preferences.best >= 0 ? preferences.best : 0;
  let bestStage = Number.isSafeInteger(preferences.bestStage) && preferences.bestStage>=0 ? preferences.bestStage : 0;
  let delay = [200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000,1050,1100,1150,1200].includes(preferences.delay) ? preferences.delay : 650;
  let sound = preferences.sound === true, audio;
  const center = Math.floor(E.SIZE / 2) * E.SIZE + Math.floor(E.SIZE / 2);
  let state = E.create('octago-001'), paused = false, timer, logs = [], undo = null, hovered = null, focused = center, modalPause = null;
  let view='title',resumePause=false,run=makeRun();
  function makeRun(){return {id:P.newId(),token:P.newId(),revision:0,name:L.playerName(),actions:[]};}
  let previewState = null;
  const previewCache = new Map();
  const buttons = [];
  const fillTiming = new Map();
  let queueEntries = [];
  let dragSlot = null, pointerDrag = null, dragGhost = null, suppressClickUntil = 0;
  const playArea = document.querySelector('.play-area');
  let hitStopUntil = 0, hitStopTimer;
  const scoreLayer = document.createElement('div');
  scoreLayer.className = 'score-popups'; scoreLayer.setAttribute('aria-hidden', 'true');
  scoreLayer.style.setProperty('--points-time',SCORE_POPUP_MS+'ms');
  function hitStopRemaining() { return Math.max(0,hitStopUntil-performance.now()); }
  function endHitStop() {
    clearTimeout(hitStopTimer); hitStopTimer = undefined; hitStopUntil = 0;
    playArea.classList.remove('hit-stop'); delete $('board').dataset.hitStop;
    $('step-button').disabled = !['running','settling'].includes(state.status);
  }
  function startHitStop() {
    endHitStop(); hitStopUntil = performance.now()+HIT_STOP_MS;
    playArea.classList.add('hit-stop'); $('board').dataset.hitStop = 'true';
    $('step-button').disabled = true;
    hitStopTimer = setTimeout(endHitStop,HIT_STOP_MS);
  }
  function persist() { try { localStorage.setItem('octago-chain-v1', JSON.stringify({ best, bestStage, delay, sound })); } catch {} }
  function coordinate(index) { return `${String.fromCharCode(65 + index % state.size)}${Math.floor(index / state.size) + 1}`; }
  function itemIcon(type) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ITEMS[type].icon}</svg>`; }
  const lockIcon='<svg class="special-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></svg>';
  function lootMarkup(card) { return `<span class="${card.item?'card-loot-badge':'card-loot'}${card.persistentMystery?' persistent-loot':''}" aria-hidden="true">?${lockIcon}</span>`; }
  function moveMarkup(card,type,value) { return `<span class="card-${type}${card.item?'-badge':''}" aria-hidden="true">${value}${lockIcon}</span>`; }
  function cardMarkup(card) {
    return `<span class="card-inner">${card.sides.map((out, d) => out === null ? '' : `<span class="side-arrow ${out ? 'out' : 'in'}${d%2 ? ' diagonal' : ''}" data-direction="${d}" style="--dir:${d}">${arrow}</span>`).join('')}${card.item?`<span class="card-item" data-item="${card.item}">${itemIcon(card.item)}</span>`:''}${card.mystery?lootMarkup(card):''}${card.bonus?moveMarkup(card,'bonus','+'+E.BONUS_VALUE):''}${card.penalty?moveMarkup(card,'penalty','−'+E.PENALTY_VALUE):''}</span>`;
  }
  function description(card, index) { const p=appearance(card);return `${coordinate(index)}, ${p.name}, 화살표 ${p.total}개, 바깥 ${p.out}개, 안쪽 ${p.inward}개, 발동 시 즉시 파괴${E.isSpecial(card)?', 연쇄 전용 · 직접 선택 불가':''}${card.item?', '+ITEMS[card.item].detail:''}${card.mystery?(card.persistentMystery?', 청록색 보존 물음표 · 발동 전까지 위치 유지 · 발동 시 랜덤 아이템 획득':', 물음표 보급 카드 · 발동 시 랜덤 아이템 획득'):''}${card.bonus?`, 발동 시 남은 횟수 +${E.BONUS_VALUE}`:''}${card.penalty?`, 발동 시 남은 횟수 −${E.PENALTY_VALUE} · ${card.penaltyMode==='random'?'난이도 무관 무작위 배치':'난이도에 따른 배치'}`:''}, ${card.sides.map((out,d) => E.DIRECTION_NAMES[d] + (out === null ? ' 없음' : out ? ' 바깥' : ' 안쪽')).join(', ')}`; }
  function destructionMarkup(card, width, phase, spawnDelay = 0) {
    const p = appearance(card), effectColor = p.tone==='blue'?'#2d55ed':p.tone==='yellow'?'#c79900':'#64748e';
    const level = Math.min(8,Math.max(0,phase-1)), strength = level/8;
    const burstScale = 1+Math.log2(Math.max(1,phase))*.45;
    const particleCount = 8+level*2, ringCount = 1+Math.floor(level/3);
    const fxTime = Math.min(500,Math.max(80,delay-spawnDelay-20));
    const particles = Array.from({length:particleCount}, (_,i) => {
      const angle = i * Math.PI * 2 / particleCount, spread = width * (i % 2 ? .5 : .62) * (1+strength*.85) * burstScale;
      return `<i class="destroy-shard" style="--dx:${(Math.cos(angle)*spread).toFixed(1)}px;--dy:${(Math.sin(angle)*spread).toFixed(1)}px;--spin:${(i%2?160:-130)*(1+strength)}deg;--delay:${i%3*12}ms"></i>`;
    }).join('');
    const flakes = Array.from({length:6+level},(_,i)=>{
      const direction=(i*137.5+phase*19)*Math.PI/180, drift=width*(.35+(i%3)*.14)*burstScale;
      const color=i%3===0?p.surface:card.sides[i%8]?'#2d55ed':'#ed8d99';
      return `<i class="destroy-flake" style="--flake-x:${Math.cos(direction)*drift}px;--flake-lift:${-width*(.25+(i%3)*.12)*burstScale}px;--flake-fall:${width*(.45+(i%4)*.13)*burstScale}px;--flake-spin:${(i%2?-1:1)*(420+i*37)}deg;--flake-size:${Math.max(4,width*.1+(i%3))}px;--flake-color:${color}"></i>`;
    }).join('');
    const rings = Array.from({length:ringCount},(_,i)=>`<span class="destroy-ring" style="--ring-delay:${i*Math.min(34,fxTime*.16)}ms"></span>`).join('');
    const rays = level<2 ? '' : Array.from({length:4+Math.floor(level/2)},(_,i)=>`<i class="destroy-ray" style="--angle:${i*360/(4+Math.floor(level/2))+phase*11}deg;--ray-length:${width*(.18+strength*.16)*burstScale}px;--ray-travel:${width*(.25+strength*.35)*burstScale}px"></i>`).join('');
    return `<span class="destroy-fx${spawnDelay>0?' spawn-delayed':''}" aria-hidden="true" data-fx-phase="${phase}" style="color:${effectColor};--surface:${p.surface};--fx-time:${fxTime}ms;--fx-glow:${(18+strength*26)*burstScale}px;--flash-scale:${1+(burstScale-1)*.3};--ring-end:${(2.1+strength*1.3)*burstScale};--ring-width:${2+strength*1.5}px;--shard-size:${(7+strength*4)*Math.sqrt(burstScale)}px;--impact-scale:${1+strength*.14};--card-spin:${strength*35}deg"><span class="destroy-flash"></span>${rings}<span class="destroy-ghost">${cardMarkup(card)}</span>${rays}${flakes}${particles}</span>`;
  }
  function showPoints(event) {
    for (const index of event.broken) {
      scoreLayer.querySelector(`[data-card-index="${index}"]`)?.remove();
      const popup = document.createElement('span'); popup.className = 'score-popup';
      popup.dataset.cardIndex = index; popup.dataset.phase = event.phase;
      const spawnDelay = fillTiming.get(index) || 0;
      popup.style.setProperty('--spawn-delay',spawnDelay+'ms');
      popup.style.gridColumn = index % state.size + 1;
      popup.style.gridRow = Math.floor(index / state.size) + 1;
      const amount = document.createElement('span'); amount.className = 'destroy-points';
      amount.textContent = '+' + number(event.perCard);
      popup.append(amount); scoreLayer.append(popup);
      const reward=event.bonusRewards.find(reward=>reward.index===index);
      if(reward){const bonus=document.createElement('span');bonus.className='bonus-points';bonus.textContent='+'+reward.amount+'회';popup.append(bonus);}
      const penalty=event.penaltyEffects.find(effect=>effect.index===index);
      if(penalty){const loss=document.createElement('span');loss.className='penalty-points';loss.textContent='−'+penalty.amount+'회';popup.append(loss);}
      setTimeout(() => popup.remove(), SCORE_POPUP_MS + spawnDelay);
    }
  }
  function renderQueue(animate) {
    const waiting = state.respawns.flatMap((pending,index)=>pending?[{at:pending.at,index}]:[]).sort((a,b)=>a.at-b.at||a.index-b.index);
    const list = $('card-queue'), cards = state.queue.slice(0,8);
    const changed = cards.some((card,index)=>card!==queueEntries[index]?.card);
    const consumed = animate && changed && queueEntries.length ? state.lastEvent?.filled?.length || 0 : 0;
    const previous = new Map(queueEntries.map(entry=>[entry.card,entry]));
    const positions = new Map(consumed ? queueEntries.flatMap(({card,node})=>{
      const rect=node.getBoundingClientRect();return rect.height ? [[card,rect.top]] : [];
    }) : []);
    if(changed){
      queueEntries.forEach(({card,node})=>{
        node.classList.remove('queue-rising');
        if(!cards.includes(card))node.remove();
      });
    }
    queueEntries = cards.map((card,order)=>{
      const p=appearance(card),target=waiting[order];
      let node=previous.get(card)?.node;
      if(!node){
        node=document.createElement('li');node.className='queue-item';
        node.dataset.sides=card.sides.map(v=>v===null?'-':v?'1':'0').join('');
        node.dataset.persistentMystery=String(Boolean(card.persistentMystery));
        node.innerHTML=`<span class="queue-order"></span><div class="card ${p.class}${card.persistentMystery?' chain-only persistent-mystery':''}" style="--surface:${p.surface}" role="img">${cardMarkup(card)}</div><span class="queue-destination"></span>`;
      }
      node.classList.toggle('queue-head',order===0);node.dataset.queueOrder=order+1;
      node.querySelector('.queue-order').textContent=String(order+1).padStart(2,'0');
      const queueLabel=`${order+1}번째 보충 카드, 화살표 ${p.total}개, 바깥 ${p.out}개, 안쪽 ${p.inward}개${card.persistentMystery?', 청록색 보존 물음표 · 스테이지가 바뀌어도 유지 · 연쇄 전용':''}`;
      node.querySelector('.card').setAttribute('aria-label',queueLabel);
      node.querySelector('.queue-destination').textContent=target?`${coordinate(target.index)} · P${target.at}`:'대기';
      if(target){node.dataset.target=target.index;node.dataset.spawnPhase=target.at;}
      else{delete node.dataset.target;delete node.dataset.spawnPhase;}
      if(list.children[order]!==node)list.insertBefore(node,list.children[order]||null);
      return {card,node};
    });
    if(consumed){
      const visible=queueEntries.map(entry=>({...entry,rect:entry.node.getBoundingClientRect()})).filter(entry=>entry.rect.height>0);
      const pitch=visible.length>1?visible[1].rect.top-visible[0].rect.top:visible[0]?.rect.height||0;
      const total=Math.min(360,delay*.9),duration=total*.72,stagger=(total-duration)/Math.max(1,visible.length-1);
      visible.forEach(({card,node,rect},order)=>{
        const shift=positions.has(card)?positions.get(card)-rect.top:Math.min(consumed,visible.length)*pitch;
        node.style.setProperty('--queue-shift',Math.max(0,shift)+'px');
        node.style.setProperty('--queue-time',duration+'ms');
        node.style.setProperty('--queue-delay',order*stagger+'ms');
        node.classList.add('queue-rising');
      });
    }
  }
  function updatePlacement() {
    const type=dragSlot!==null&&state.status==='idle'&&state.inventory[dragSlot];
    $('board').classList.toggle('placing-item',Boolean(type));
    document.querySelectorAll('.item-slot').forEach(button=>button.classList.toggle('dragging',Boolean(type&&Number(button.dataset.itemSlot)===dragSlot)));
    $('item-hint').textContent=state.status==='gameover'?'게임오버 · 새 게임을 시작하세요':state.status!=='idle'?'연쇄가 끝나면 장착할 수 있어요':type?`${ITEMS[type].name} · 장착할 카드 위에 놓으세요`:'드래그해 장착 · 청록 ?는 스테이지 유지';
  }
  function renderItems() {
    $('item-capacity').textContent=state.inventory.filter(Boolean).length+' / 3';
    $('item-slots').innerHTML=state.inventory.map((type,slot)=>`<button type="button" class="item-slot${type?' occupied':''}" data-item-slot="${slot}"${type?` data-item="${type}"`:''} draggable="false"${!type||state.status!=='idle'?' disabled':''} aria-label="${slot+1}번 아이템 칸, ${type?ITEMS[type].detail+', 카드로 드래그해 장착':'비어 있음'}"><span class="item-slot-number">0${slot+1}</span><span class="item-slot-icon">${type?itemIcon(type):'+'}</span><span class="item-slot-label">${type?ITEMS[type].name:'빈 슬롯'}</span></button>`).join('');
    updatePlacement();
  }
  function clearDropTarget() { buttons.forEach(button=>button.classList.remove('item-drop-target')); }
  function finishItemDrag() {
    const drag=pointerDrag;pointerDrag=null;
    if(drag?.moved)suppressClickUntil=performance.now()+300;
    if(drag&&$('item-slots').hasPointerCapture(drag.pointer))$('item-slots').releasePointerCapture(drag.pointer);
    dragGhost?.remove();dragGhost=null;dragSlot=null;clearDropTarget();
    updatePlacement();
  }
  function canEquip(index) { return state.status==='idle'&&Number.isInteger(index)&&Boolean(state.board[index])&&!state.board[index].item; }
  function applyItem(slot,index) {
    if(dragSlot!==slot)return false;
    if(!canEquip(index)||!state.inventory[slot]){toast('아이템이 없는 카드에 장착할 수 있습니다.');return false;}
    undo={state,logs:logs.slice(),actions:run.actions.slice()};state=E.equip(state,slot,index);run.actions.push({type:'equip',slot,index});hovered=index;suppressClickUntil=performance.now()+300;
    finishItemDrag();render();toast(`${coordinate(index)}에 ${ITEMS[state.board[index].item].name} 장착`);return true;
  }
  function dropTargetAt(x,y) {
    const button=document.elementFromPoint(x,y)?.closest('#board > button[data-index]'),index=button?Number(button.dataset.index):null;
    clearDropTarget();if(canEquip(index))button.classList.add('item-drop-target');return index;
  }
  function toast(message) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role','status'); el.textContent = message;
    document.body.append(el); setTimeout(() => el.remove(), 2200);
  }
  function chime(event) {
    if (!sound) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume();
      const gain = audio.createGain(), osc = audio.createOscillator(), at = audio.currentTime;
      gain.connect(audio.destination); gain.gain.setValueAtTime(.022, at); gain.gain.exponentialRampToValueAtTime(.0001, at + .23);
      osc.connect(gain); osc.type = 'sine'; osc.frequency.setValueAtTime(220 + Math.min(15, event.phase) * 35, at);
      osc.frequency.exponentialRampToValueAtTime(event.broken.length ? 880 : 440, at + .18); osc.start(); osc.stop(at + .25);
    } catch {}
  }
  function drawLinks(links, animate = false) {
    const board = $('board'), gap = parseFloat(getComputedStyle(board).gap) || 0;
    const unit = (board.clientWidth - gap * (state.size - 1)) / state.size, pitch = unit + gap, size = board.clientWidth;
    $('links').setAttribute('viewBox', '0 0 100 100');
    const point = i => [(i % state.size * pitch + unit / 2) / size * 100, (Math.floor(i / state.size) * pitch + unit / 2) / size * 100];
    $('links').innerHTML = links.map(link => {
      const [x1,y1] = point(link.from), [x2,y2] = point(link.to), dx = x2-x1, dy = y2-y1;
      const fromX=x1+dx*.15,fromY=y1+dy*.15,toX=x2-dx*.15,toY=y2-dy*.15,angle=Math.atan2(dy,dx)*180/Math.PI;
      return `<g class="signal-flight${animate?'':' signal-static'}${link.item?' item-signal':''}" data-from="${link.from}" data-to="${link.to}" data-direction="${link.direction}" style="--from-x:${fromX}px;--from-y:${fromY}px;--to-x:${toX}px;--to-y:${toY}px;--flight-time:${Math.min(350,delay*.7)}ms"><g transform="rotate(${angle})"><path class="signal-tail" d="M-.5 0 -2.1-.7 -2.1.7Z"/><path class="signal-arrow" d="M1.25 0 -.75-.8 -.75.8Z"/></g></g>`;
    }).join('');
  }
  function highlightSignals(links) {
    for(const link of links){
      if(link.item){buttons[link.from].querySelector('.destroy-ghost .card-item')?.classList.add('item-emitting');continue;}
      buttons[link.from].querySelector(`.destroy-ghost .side-arrow.out[data-direction="${link.direction}"]`)?.classList.add('chain-out');
      buttons[link.to].querySelector(`:scope > .card-inner .side-arrow.in[data-direction="${(link.direction+4)%8}"]`)?.classList.add('chain-in');
    }
  }
  function clearPreview() {
    buttons.forEach((button, index) => {
      button.classList.remove('inspecting', 'direct-target', 'preview-hit', 'preview-source', 'preview-destroyed');
      button.querySelectorAll('.side-arrow.preview-link').forEach(arrow=>arrow.classList.remove('preview-link','preview-out','preview-in'));
      button.querySelector('.card-item.preview-item')?.classList.remove('preview-item');
      delete button.dataset.previewDestroyed;
      if (state.board[index]) {
        button.setAttribute('aria-label', description(state.board[index], index));
      }
    });
    delete $('board').dataset.previewSource;
    $('chain-preview').hidden = true;
    if (state.status === 'idle') $('field-state').textContent = 'READY';
  }
  function showPreview(index) {
    if (previewState !== state) { previewState = state; previewCache.clear(); }
    if (!previewCache.has(index)) previewCache.set(index, E.preview(state, index));
    const trace = previewCache.get(index);
    for (const visit of trace.cards) {
      const button = buttons[visit.index];
      button.classList.add('preview-hit');
      button.classList.toggle('preview-source', visit.index === index);
      button.classList.toggle('preview-destroyed', visit.destroyedAt !== null);
      button.dataset.previewDestroyed = String(visit.destroyedAt !== null);
      const detail = '현재 카드의 연쇄 발동·파괴 예상';
      button.setAttribute('aria-label', button.getAttribute('aria-label') + ', ' + detail);
    }
    buttons[index].classList.add('inspecting');
    $('board').dataset.previewSource = index;
    $('field-state').textContent = 'PREVIEW';
    $('preview-phases').textContent = trace.phases + (trace.complete ? '' : '+');
    $('preview-cards').textContent = trace.cards.length;
    $('preview-destroyed').textContent = trace.destroyed;
    $('preview-score').textContent = '+' + number(trace.points) + (trace.complete ? '' : '+');
    $('chain-preview').title = trace.complete ? '현재 필드의 카드만 계산한 예상 결과 · 보충 카드 제외' : `현재 카드의 연쇄를 ${E.PREVIEW_PHASE_LIMIT}페이즈까지 계산한 예상 최솟값입니다.`;
    $('chain-preview').hidden = false;
    for(const link of trace.links){
      if(link.item){buttons[link.from].querySelector(':scope > .card-inner .card-item')?.classList.add('preview-item');continue;}
      for(const [cardIndex,direction,role] of [[link.from,link.direction,'out'],[link.to,(link.direction+4)%8,'in']]){
        const side=buttons[cardIndex].querySelector(`:scope > .card-inner .side-arrow.${role}[data-direction="${direction}"]`);
        if(side)side.classList.add('preview-link','preview-'+role);
      }
    }
    drawLinks([]);
  }
  function inspect(index) {
    hovered = index;
    clearPreview();
    const card = state.board[index];
    if (!card) {
      $('inspect-coordinate').textContent = coordinate(index);
      $('inspect-preview').innerHTML = '<span>·</span>';
      $('inspect-name').textContent = '재생성 대기';
      $('inspect-detail').textContent = `${state.respawns[index]?.at-state.phase||0}페이즈 후 새 카드 생성`;
      return;
    }
    $('inspect-coordinate').textContent = coordinate(index);
    const p=appearance(card);
    $('inspect-preview').innerHTML = `<div class="card ${p.class}" style="--surface:${p.surface}">${cardMarkup(card)}</div>`;
    $('inspect-name').textContent = p.name;
    const targets = E.connections(state, index);
    $('inspect-detail').textContent = `화살표 ${p.total}개 · 바깥 ${p.out} / 안쪽 ${p.inward}\n연결 ${targets.length}장${targets.length ? ' → ' + targets.map(coordinate).join(' · ') : ''}${card.item?'\n'+ITEMS[card.item].detail:''}${card.mystery?(card.persistentMystery?'\n청록 ? · 스테이지가 바뀌어도 같은 자리 유지\n발동 시 랜덤 아이템 획득':'\n? 발동 시 랜덤 아이템 획득'):''}${card.bonus?`\n+${E.BONUS_VALUE} 발동 횟수 회복`:''}${card.penalty?`\n−${E.PENALTY_VALUE} 발동 횟수 감소 · ${card.penaltyMode==='random'?'난이도 무관 무작위 배치':'난이도에 따른 배치'}`:''}`;
    if(E.isSpecial(card))$('inspect-detail').textContent+='\n연쇄 전용 · 직접 선택 불가';
    if (state.status === 'idle'&&dragSlot===null) {
      if(E.isSpecial(card)){clearPreview();drawLinks([]);$('field-state').textContent='연쇄 전용';}
      else showPreview(index);
    }
  }
  function clearInspect() {
    hovered = null; clearPreview();
    if (state.status === 'idle') drawLinks([]);
  }
  function render(animate = false) {
    clearPreview();
    const event = state.lastEvent, pending = ['running','settling'].includes(state.status),over=state.status==='gameover';
    const active = new Set(event?.active || (pending ? state.frontier : []));
    const next = new Set(event?.next || []), filled = new Set(event?.filled || []), broken = new Set(event?.broken || []);
    const following = new Set([...next].flatMap(index => E.connections(state,index)).filter(index => !next.has(index)));
    const brokenCards = new Map((event?.brokenCards || []).map(b => [b.index,b.card]));
    fillTiming.clear();
    const interval = Math.min(24,(Math.min(240,delay*.8)-70)/Math.max(1,filled.size-1));
    if (animate) (event?.filled || []).forEach((index,order) => fillTiming.set(index,order*interval));
    $('board').dataset.status = state.status; $('board').dataset.phase = state.phase;
    state.board.forEach((card, index) => {
      const button = buttons[index];
      button.disabled = pending||over; button.tabIndex = index === focused ? 0 : -1;
      button.setAttribute('aria-disabled',String(pending||over||E.isSpecial(card)));
      if(E.isSpecial(card))button.setAttribute('aria-describedby','special-card-rule');else button.removeAttribute('aria-describedby');
      delete button.dataset.respawnIn;
      delete button.dataset.spawnOrder;
      delete button.dataset.item;delete button.dataset.penaltyMode;button.dataset.mystery=String(Boolean(card?.mystery));button.dataset.persistentMystery=String(Boolean(card?.persistentMystery));button.dataset.bonus=String(Boolean(card?.bonus));button.dataset.penalty=String(Boolean(card?.penalty));
      if(card?.penalty&&card.penaltyMode)button.dataset.penaltyMode=card.penaltyMode;
      const spawnOrder = (event?.filled || []).indexOf(index) + 1, spawnDelay = fillTiming.get(index) || 0;
      button.style.setProperty('--spawn-delay',spawnDelay+'ms');
      if (spawnOrder) button.dataset.spawnOrder = spawnOrder;
      button.className = 'card';
      if (card) {
        const p=appearance(card);button.classList.add(p.class);
        if(E.isSpecial(card))button.classList.add('chain-only');
        if(card.persistentMystery)button.classList.add('persistent-mystery');
        if(card.item)button.dataset.item=card.item;
        button.dataset.outCount=p.out;button.dataset.inCount=p.inward;button.dataset.arrowCount=p.total;
        button.style.setProperty('--surface',p.surface);
        if (active.has(index)) button.classList.add('active');
        if (next.has(index)) button.classList.add('queued');
        else if (following.has(index)) button.classList.add('queued-later');
        if (animate && filled.has(index)) button.classList.add('just-filled');
        button.innerHTML = cardMarkup(card) + (animate&&spawnOrder ? `<span class="spawn-order" aria-hidden="true">+${String(spawnOrder).padStart(2,'0')}</span>` : ''); button.setAttribute('aria-label', description(card,index));
      } else {
        delete button.dataset.outCount;delete button.dataset.inCount;delete button.dataset.arrowCount;
        const remaining=state.respawns[index]?state.respawns[index].at-state.phase:0,destroyedCard=brokenCards.get(index);
        button.classList.add(broken.has(index)?'broken':'hole');if(next.has(index))button.classList.add('queued');
        if(remaining){button.classList.add('respawn-wait');button.dataset.respawnIn=remaining;}
        if(destroyedCard){const p=appearance(destroyedCard);button.classList.add(p.class);button.style.setProperty('--surface',p.surface);}
        if(animate&&destroyedCard)button.classList.add('shattering');
        button.innerHTML=`${broken.has(index)?'<span class="broken-mark">×</span>':''}${animate&&destroyedCard?destructionMarkup(destroyedCard,button.clientWidth,event.phase,spawnDelay):''}${remaining?`<span class="respawn-count">${remaining}</span>`:''}`;
        button.setAttribute('aria-label', `${coordinate(index)}, ${remaining}페이즈 뒤 재생성${next.has(index)?', 생성 즉시 발동 예정':''}`);
      }
    });
    $('score').textContent = number(state.score); $('best-score').textContent = number(best);
    $('remaining-moves').textContent=state.remainingMoves;$('remaining-counter').classList.toggle('low',state.remainingMoves<=3);
    $('remaining-counter').setAttribute('aria-label',`남은 발동 횟수 ${state.remainingMoves}회`);
    const stage=Math.max(1,state.moves+(pending||over?0:1));
    $('stage-number').textContent=String(stage).padStart(2,'0');
    $('difficulty-level').textContent=Math.min(stage,E.DIFFICULTY_RAMP_STAGES)+' / '+E.DIFFICULTY_RAMP_STAGES;
    $('stage-summary').dataset.stage=stage;$('stage-summary').dataset.difficulty=E.stageDifficulty(stage);
    for(const type of ['bonus','mystery','penalty'])$('special-'+type+'-count').textContent=state.board.filter(card=>card?.[type]&&!card.persistentMystery).length;
    $('persistent-mystery-count').textContent=state.board.filter(card=>card?.persistentMystery).length;
    if(view==='game'&&over)L.showResult(state,run);else L.hideResult();L.personal(best,bestStage);$('undo-gameover').disabled=!undo;
    $('moves').textContent = String(state.moves).padStart(2,'0'); $('destroyed').textContent = String(state.destroyed).padStart(2,'0'); $('best-chain').textContent = String(state.bestChain).padStart(2,'0');
    $('field-state').textContent = over?'GAME OVER':pending ? paused ? 'PAUSED' : state.status === 'settling' ? 'SETTLING' : 'REACTING' : 'READY';
    $('field-state').classList.toggle('running', pending);
    $('field-state').classList.toggle('game-over',over);
    $('monitor-tag').textContent = over?'GAME OVER':pending ? paused ? 'PAUSED' : 'LIVE' : state.moves ? 'COMPLETE' : 'STANDBY';
    $('phase').textContent = state.phase ? String(state.phase).padStart(2,'0') : '—';
    $('phase-state').textContent = over?'발동 횟수를 모두 사용했습니다':pending ? paused ? '일시정지됨' : state.status === 'settling' ? '연쇄 종료' : event?.filled?.length ? `${event.filled.length}장 재생성` : !state.frontier.length ? '재생성 대기' : '연쇄 진행 중' : state.moves ? '연쇄 완료 · 다음 카드 선택' : '카드를 클릭해 시작';
    $('active-count').innerHTML = `${event?.active?.length ?? (pending ? state.frontier.length : 0)} <small>CARDS</small>`;
    $('next-count').innerHTML = `${state.status === 'running' && state.phase ? state.frontier.length : 0} <small>CARDS</small>`;
    const scoreEvent = event?.phase ? event : logs.filter(l => l.phase).at(-1);
    $('chain-multiplier').textContent = '×' + (scoreEvent?.chainMultiplier || 1).toFixed(1);
    $('burst-multiplier').textContent = '×' + String(scoreEvent?.burstMultiplier || 1);
    $('chain-destroyed').textContent = state.chain.destroyed; $('chain-score').textContent = '+' + number(state.chain.points);
    const gain = pending ? event?.points || 0 : state.chain.points;
    $('gain').textContent = gain ? '+' + number(gain) : state.moves ? 'KEEP THE CHAIN GOING' : 'YOUR NEXT CHAIN AWAITS'; $('gain').classList.toggle('scored', gain > 0);
    $('pause-button').disabled = !pending; $('pause-button').textContent = paused ? '▶  계속 재생' : 'Ⅱ  일시정지'; $('pause-button').setAttribute('aria-pressed', String(paused));
    $('step-button').disabled = !pending || hitStopRemaining()>0; $('step-button').textContent = state.status === 'settling' ? '연쇄 마무리 →' : '다음 페이즈 →';
    $('undo-button').disabled = pending || !undo;
    $('current-seed').textContent = state.seed;
    renderLog(); renderQueue(animate); renderItems(); highlightSignals(event?.links || []); drawLinks(event?.links || [],animate);
    if (hovered !== null) inspect(hovered);
  }
  function renderLog() {
    const el = $('event-log');
    $('log-caption').textContent = state.moves ? 'CLICK ' + String(state.moves).padStart(2,'0') : 'LATEST CHAIN';
    if (!logs.length) { el.innerHTML = '<p class="log-placeholder">첫 카드를 클릭하면 연쇄 과정이 여기에 기록됩니다.</p>'; return; }
    el.innerHTML = logs.map(log => log.phase ? `<div class="log-row"><span class="log-phase">PHASE ${String(log.phase).padStart(2,'0')}</span><span class="log-burst">${log.active.length}장 발동</span><span>${log.broken.length}장 파괴</span>${log.filled.length ? `<span class="log-respawn">${log.filled.length}장 재생성</span>` : ''}<small>×${log.chainMultiplier} ×${log.burstMultiplier}</small><strong>+${number(log.points)}</strong></div>` : `<div class="log-row"><span class="log-phase">${log.type === 'begin' ? 'START' : 'END'}</span><span>${log.message}</span></div>`).join('');
    el.scrollTop = el.scrollHeight;
    $('log-caption').textContent = state.moves ? 'CLICK ' + String(state.moves).padStart(2,'0') : 'LATEST CHAIN';
  }
  function schedule() {
    clearTimeout(timer);
    if (view==='game'&&!paused && ['running','settling'].includes(state.status) && !document.querySelector('dialog[open]')) timer = setTimeout(advance, delay+Math.ceil(hitStopRemaining()));
  }
  function advance() {
    if (hitStopRemaining()>0) return;
    clearTimeout(timer);
    if (view!=='game'||!['running','settling'].includes(state.status)) return;
    if (state.status === 'settling') {
      state = E.complete(state);
      logs.push({ type: 'complete', message: `총 ${state.chain.spawned}장 재생성 · 연쇄 완료 +${number(state.chain.points)}` });
      best=Math.max(best,state.score);bestStage=Math.max(bestStage,state.moves+(state.status==='gameover'?0:1));persist();
      if(state.status==='gameover')run.revision++;
      paused = false; render(true);
      $('announcement').textContent = `${state.status==='gameover'?'게임오버. ':''}${state.chain.phases}페이즈 완료, ${state.chain.destroyed}장 파괴, ${state.chain.points}점 획득. 남은 발동 ${state.remainingMoves}회`;
      if(state.status==='gameover')$('result-heading').focus({preventScroll:true});
      else if(state.lastEvent.markersAdded.length){
        const added=state.lastEvent.markersAdded,bonusCount=added.filter(mark=>mark.type==='bonus').length,mysteryCount=added.filter(mark=>mark.type==='mystery').length,penaltyCount=added.filter(mark=>mark.type==='penalty').length;
        toast([bonusCount?`+1 ${bonusCount}장 재배치`:'',mysteryCount?`? ${mysteryCount}장 재배치`:'',penaltyCount?`−1 ${penaltyCount}장 재배치`:''].filter(Boolean).join(' · '));
      }
      return;
    }
    state = E.step(state); logs.push(state.lastEvent); render(true); showPoints(state.lastEvent); if(state.lastEvent.active.length)chime(state.lastEvent);
    const messages=state.lastEvent.itemRewards.map(reward=>reward.stored?`${ITEMS[reward.type].name} 아이템 획득!`:'아이템 보관함이 가득 찼습니다.');
    const gained=state.lastEvent.bonusRewards.reduce((sum,reward)=>sum+reward.amount,0),lost=state.lastEvent.penaltyEffects.reduce((sum,effect)=>sum+effect.amount,0);
    if(gained||lost)messages.push('발동 횟수 '+[gained?'+'+gained:'',lost?'−'+lost:''].filter(Boolean).join(' / '));
    if(messages.length)toast(messages.join(' · '));
    if (state.lastEvent.points>0) startHitStop();
    $('announcement').textContent = `${state.phase}페이즈, ${state.lastEvent.active.length}장 발동, ${state.lastEvent.broken.length}장 파괴, ${state.lastEvent.filled.length}장 재생성, ${state.lastEvent.points}점`;
    schedule();
  }
  function activate(index) {
    if (view!=='game'||state.status !== 'idle') return;
    if(E.isSpecial(state.board[index])){toast('연쇄 전용 카드입니다. 일반 카드에서 연쇄를 이어보세요.');return;}
    finishItemDrag();
    endHitStop();
    scoreLayer.replaceChildren();
    undo = { state, logs: logs.slice(),actions:run.actions.slice() };run.actions.push({type:'activate',index}); focused = index; hovered = null; logs = [{ type: 'begin', message: `${coordinate(index)}에서 첫 신호 발동` }];
    state = E.begin(state, index); paused = false; render(); schedule();
  }
  document.querySelector('.board-wrap').style.setProperty('--grid-size',E.SIZE);
  for (let i=0;i<E.SIZE*E.SIZE;i++) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.index = i;
    button.addEventListener('click', () => {if(performance.now()<suppressClickUntil||dragSlot!==null)return;activate(i);}); button.addEventListener('pointerenter', () => inspect(i));
    button.addEventListener('pointerleave', () => { if (hovered === i) clearInspect(); });
    button.addEventListener('focus', () => { focused = i; buttons.forEach((b,n) => b.tabIndex = n === i ? 0 : -1); inspect(i); });
    button.addEventListener('keydown', event => {
      const direction = { ArrowUp:0, ArrowRight:2, ArrowDown:4, ArrowLeft:6 }[event.key];
      if (direction !== undefined) { event.preventDefault(); const next = E.adjacent(i,direction); if (next >= 0) buttons[next].focus(); }
    });
    buttons.push(button); $('board').append(button);
  }
  $('board').append(scoreLayer);
  $('board').addEventListener('pointerleave', clearInspect);
  $('board').addEventListener('focusout', event => {
    if (!$('board').contains(event.relatedTarget) && !$('board').matches(':hover')) clearInspect();
  });
  document.querySelector('.col-labels').innerHTML = Array.from({length:E.SIZE},(_,i)=>`<span>${String.fromCharCode(65+i)}</span>`).join('');
  document.querySelector('.row-labels').innerHTML = Array.from({length:E.SIZE},(_,i)=>`<span>${String(i+1).padStart(2,'0')}</span>`).join('');
  $('item-slots').addEventListener('dragstart',event=>event.preventDefault());
  $('item-slots').addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false||pointerDrag)return;const slot=event.target.closest('[data-item-slot]');
    if(!slot||state.status!=='idle'||!state.inventory[Number(slot.dataset.itemSlot)])return;
    event.preventDefault();
    pointerDrag={slot:Number(slot.dataset.itemSlot),x:event.clientX,y:event.clientY,moved:false,pointer:event.pointerId};$('item-slots').setPointerCapture(event.pointerId);
  });
  $('item-slots').addEventListener('pointermove',event=>{
    if(!pointerDrag||event.pointerId!==pointerDrag.pointer)return;
    if(!pointerDrag.moved&&Math.hypot(event.clientX-pointerDrag.x,event.clientY-pointerDrag.y)>7){
      pointerDrag.moved=true;dragSlot=pointerDrag.slot;clearInspect();updatePlacement();
      dragGhost=document.createElement('div');dragGhost.className='item-drag-ghost';dragGhost.dataset.item=state.inventory[dragSlot];dragGhost.innerHTML=itemIcon(state.inventory[dragSlot]);document.body.append(dragGhost);
    }
    if(pointerDrag.moved){event.preventDefault();dragGhost.style.left=event.clientX+'px';dragGhost.style.top=event.clientY+'px';dropTargetAt(event.clientX,event.clientY);}
  });
  $('item-slots').addEventListener('pointerup',event=>{
    if(!pointerDrag||event.pointerId!==pointerDrag.pointer)return;const drag=pointerDrag;
    if(drag.moved){event.preventDefault();const index=dropTargetAt(event.clientX,event.clientY);if(canEquip(index))applyItem(drag.slot,index);}
    finishItemDrag();
  });
  $('item-slots').addEventListener('pointercancel',event=>{if(pointerDrag?.pointer===event.pointerId)finishItemDrag();});
  $('item-slots').addEventListener('lostpointercapture',event=>{if(pointerDrag?.pointer===event.pointerId)finishItemDrag();});
  window.addEventListener('blur',()=>finishItemDrag());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finishItemDrag();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(dragSlot!==null||pointerDrag!==null)){event.preventDefault();finishItemDrag();}});
  $('pause-button').onclick = () => { paused = !paused; render(); schedule(); };
  $('step-button').onclick = () => { paused = true; advance(); };
  $('undo-button').onclick = () => { if (!undo || !['idle','gameover'].includes(state.status)) return; finishItemDrag();clearTimeout(timer); endHitStop(); scoreLayer.replaceChildren(); state = undo.state; logs = undo.logs;run.actions=undo.actions.slice(); undo = null; paused = false; hovered = null; render(); toast('직전 행동 이전으로 되돌렸습니다.'); };
  $('undo-gameover').onclick=()=>$('undo-button').click();
  $('play-again').onclick=()=>startNewGame(freshSeed());
  $('speed').value = delay;
  function updateSpeed() { $('speed-label').textContent = (delay / 1000).toFixed(2) + 's / PHASE'; }
  $('speed').oninput = () => { delay = Number($('speed').value); updateSpeed(); persist(); schedule(); };
  $('sound-button').setAttribute('aria-pressed', String(sound));
  function updateSound() { $('sound-button').setAttribute('aria-pressed',String(sound)); $('sound-button').setAttribute('aria-label',sound ? '효과음 끄기' : '효과음 켜기'); }
  $('sound-button').onclick = () => { sound = !sound; updateSound(); persist(); if(sound)chime({phase:1,broken:[]}); };
  function openDialog(id) { finishItemDrag();clearInspect(); modalPause = paused; paused = true; clearTimeout(timer); render(); $(id).showModal(); }
  $('help-button').onclick = () => openDialog('help-dialog');
  function freshSeed() { return 'octago-' + Math.random().toString(36).slice(2,8); }
  $('new-button').onclick = () => { $('seed-input').value = freshSeed(); openDialog('new-dialog'); };
  $('random-seed').onclick = () => { $('seed-input').value = freshSeed(); };
  function startNewGame(seed) {
    finishItemDrag();
    clearTimeout(timer); endHitStop(); scoreLayer.replaceChildren(); state = E.create(seed);run=makeRun(); logs = []; undo = null; hovered = null; paused = false; modalPause = null; focused = center;
    if($('new-dialog').open)$('new-dialog').close();view='game';L.showGame();$('log-caption').textContent = 'LATEST CHAIN'; render();
    $('inspect-coordinate').textContent='HOVER A CARD'; $('inspect-preview').innerHTML='<span>↗</span>'; $('inspect-name').textContent='흐름을 살펴보세요'; $('inspect-detail').textContent='카드에 마우스를 올리면 연결되는 화살표가 강조됩니다.';
  }
  $('start-button').onclick=()=>startNewGame($('seed-input').value.trim()||freshSeed());
  function showTitle(){finishItemDrag();clearInspect();clearTimeout(timer);endHitStop();if(view!=='title')resumePause=paused;paused=true;view='title';L.personal(best,bestStage);L.showTitle(state.moves>0&&state.status!=='gameover');}
  function resumeGame(){view='game';paused=resumePause;L.showGame();render();schedule();}
  $('seed-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('start-button').click(); }
  });
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => { if (modalPause !== null) { paused = modalPause; modalPause = null; render(); schedule(); } }));
  window.addEventListener('resize', () => { if (hovered !== null) inspect(hovered); else drawLinks(state.lastEvent?.links || []); });
  L.bind({start:()=>startNewGame(freshSeed()),resume:resumeGame,home:showTitle});
  updateSpeed(); updateSound(); render();L.showTitle(false);
})();
