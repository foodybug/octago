(function (root) {
  'use strict';
  const SIZE = 8, BASE_POINTS = 100;
  const ROTATION_ENABLED = false, RESPAWN_DELAY = 2, PREVIEW_PHASE_LIMIT = 512;
  const MIN_ARROWS = 5, MAX_ARROWS = 8;
  const QUEUE_SIZE = 64, QUEUE_MYSTERY_CHANCE = .03;
  const ITEM_TYPES = Object.freeze(['row','column','adjacent']), INVENTORY_SIZE = 3;
  const INITIAL_MOVES = 3, BONUS_BATCH_SIZE = 3, BONUS_VALUE = 1, MYSTERY_BATCH_SIZE = 1, PENALTY_BATCH_SIZE = 2, PENALTY_VALUE = 1;
  const DIFFICULTY_RAMP_STAGES = 20;
  const ARROW_COUNT_WEIGHTS = Object.freeze([25,25,25,25]);
  const DIRS = [[-1,0], [-1,1], [0,1], [1,1], [1,0], [1,-1], [0,-1], [-1,-1]];
  const DIRECTION_NAMES = ['위','오른쪽 위','오른쪽','오른쪽 아래','아래','왼쪽 아래','왼쪽','왼쪽 위'];
  const DIRECTION_MASKS = Array.from({length:MAX_ARROWS-MIN_ARROWS+1},(_,i)=>
    Array.from({length:256},(_,mask)=>mask).filter(mask=>mask.toString(2).replace(/0/g,'').length===i+MIN_ARROWS));
  function seedNumber(seed) {
    let hash = 2166136261;
    for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  }
  function random(rng) {
    const next = (rng + 0x6D2B79F5) >>> 0;
    let value = next;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return { value: ((value ^ value >>> 14) >>> 0) / 4294967296, rng: next };
  }
  function randomCard(rng) {
    const countRoll=random(rng),slotsRoll=random(countRoll.rng),directionRoll=random(slotsRoll.rng);
    const countIndex=Math.floor(countRoll.value*DIRECTION_MASKS.length),count=countIndex+MIN_ARROWS;
    const masks=DIRECTION_MASKS[countIndex],occupied=masks[Math.floor(slotsRoll.value*masks.length)];
    const outward=1+Math.floor(directionRoll.value*((1<<count)-2));let arrow=0;
    return {card:{sides:Array.from({length:8},(_,d)=>occupied & 1<<d ? Boolean(outward & 1<<arrow++) : null)},rng:directionRoll.rng};
  }
  function randomQueuedCard(rng,queueRng) {
    const roll=randomCard(rng),special=random(queueRng);
    return {...roll,card:special.value<QUEUE_MYSTERY_CHANCE?{...roll.card,mystery:true,persistentMystery:true}:roll.card,queueRng:special.rng};
  }
  function profile(card) {
    const out = card.sides.filter(v=>v===true).length, inward = card.sides.filter(v=>v===false).length;
    return { out, inward, total: out + inward, absent: card.sides.length - out - inward, tone: out > inward ? 'blue' : out < inward ? 'yellow' : 'neutral' };
  }
  function adjacent(index, direction, size = SIZE) {
    const row = Math.floor(index / size) + DIRS[direction][0], col = index % size + DIRS[direction][1];
    return row < 0 || row >= size || col < 0 || col >= size ? -1 : row * size + col;
  }
  function rotate(sides, turns) {
    const result = Array(sides.length), shift = turns * sides.length / 4;
    sides.forEach((value, direction) => { result[((direction + shift) % sides.length + sides.length) % sides.length] = value; });
    return result;
  }
  function stageDifficulty(stage) { return Math.max(0,Math.min(1,(stage-1)/(DIFFICULTY_RAMP_STAGES-1))); }
  function isSpecial(card) { return Boolean(card&&(card.bonus||card.mystery||card.penalty)); }
  function placeSpecials(state,reroll=false) {
    const previous=new Map(['mystery','bonus','penalty'].map(type=>[type,new Set(reroll?state.board.flatMap((card,index)=>card?.[type]&&!card.persistentMystery?[index]:[]):[])]));
    const board=state.board.map(card=>{if(!reroll||!card||card.persistentMystery||!isSpecial(card))return card;const {mystery,bonus,penalty,penaltyMode,...normal}=card;return normal;}),markersAdded=[],difficulty=stageDifficulty(state.moves+1),span=Math.max(1,state.size-1);
    let markerRng=state.markerRng;
    const indices=type=>board.flatMap((card,index)=>card?.[type]&&!card.persistentMystery?[index]:[]);
    const available=type=>{
      const candidates=board.flatMap((card,index)=>card&&!card.mystery&&!card.bonus&&!card.penalty?[index]:[]),fresh=candidates.filter(index=>!previous.get(type).has(index));
      return fresh.length?fresh:candidates;
    };
    // Draw the unrestricted penalty first, before any difficulty-dependent placements.
    const randomCandidates=available('penalty');
    if(randomCandidates.length){
      const roll=random(markerRng);markerRng=roll.rng;const index=randomCandidates[Math.floor(roll.value*randomCandidates.length)];
      board[index]={...board[index],penalty:true,penaltyMode:'random'};markersAdded.push({index,type:'penalty'});
    }
    // Eight-direction distance: a diagonal step costs the same as a straight step.
    const distance=(a,b)=>Math.max(Math.abs(Math.floor(a/state.size)-Math.floor(b/state.size)),Math.abs(a%state.size-b%state.size));
    const rewardDistance=1+difficulty*(span-1),penaltyDistance=span-difficulty*(span-1);
    for(const [type,count] of [['mystery',MYSTERY_BATCH_SIZE],['bonus',BONUS_BATCH_SIZE],['penalty',PENALTY_BATCH_SIZE]]){
      for(let missing=count-indices(type).length;missing>0;missing--){
        const candidates=available(type);
        if(!candidates.length)break;
        const rewards=[...indices('mystery'),...indices('bonus')],opposite=indices(type==='mystery'?'bonus':'mystery');
        const scores=candidates.map(index=>{
          let score=0;
          if(type==='penalty'&&rewards.length){
            score=-Math.abs(Math.min(...rewards.map(target=>distance(index,target)))-penaltyDistance);
          }else if(type!=='penalty'){
            if(opposite.length)score=-opposite.reduce((sum,target)=>sum+Math.abs(distance(index,target)-rewardDistance),0)/opposite.length;
          }
          return score;
        });
        // Weighted sampling keeps positions random while strongly favouring the desired distances.
        const best=Math.max(...scores),weights=scores.map(score=>Math.exp((score-best)*2.5)),total=weights.reduce((a,b)=>a+b,0);
        const roll=random(markerRng);markerRng=roll.rng;let choice=roll.value*total,selected=candidates.length-1;
        for(let n=0;n<candidates.length;n++){choice-=weights[n];if(choice<0){selected=n;break;}}
        const index=candidates[selected];board[index]={...board[index],[type]:true,...(type==='penalty'?{penaltyMode:'difficulty'}:{})};markersAdded.push({index,type});
      }
    }
    return {board,markerRng,markersAdded};
  }
  function create(seed = 'OCTAGO', size = SIZE) {
    if (!Number.isInteger(size) || size < 1 || size > 30) throw Error('Invalid field size');
    let rng = seedNumber(seed),queueRng=seedNumber(String(seed)+'|queue-specials');
    const board = Array.from({ length: size * size }, () => { const roll = randomCard(rng); rng = roll.rng; return roll.card; });
    const queue = Array.from({ length: Math.max(QUEUE_SIZE, size * size) }, () => { const roll = randomQueuedCard(rng,queueRng); rng = roll.rng;queueRng=roll.queueRng;return roll.card; });
    const state={ seed: String(seed), size, rng, queueRng,board, queue, respawns: Array(size*size).fill(null), frontier: [], status: 'idle', phase: 0, score: 0, moves: 0, destroyed: 0,
      inventory: Array(INVENTORY_SIZE).fill(null), itemRng: seedNumber(String(seed)+'|items'), markerRng:seedNumber(String(seed)+'|markers'), remainingMoves: INITIAL_MOVES,
      chain: { activations: 0, destroyed: 0, spawned: 0, points: 0, phases: 0, peak: 0 }, bestChain: 0, bestBurst: 0, lastEvent: null };
    const filled=placeSpecials(state);return {...state,board:filled.board,markerRng:filled.markerRng};
  }
  function start(state, index, consumeMove) {
    if (state.status !== 'idle') throw Error('A chain is already running');
    if (state.remainingMoves <= 0) throw Error('No moves remaining');
    if (!Number.isInteger(index) || index < 0 || index >= state.board.length || !state.board[index]) throw Error('Invalid card');
    if (isSpecial(state.board[index])) throw Error('Special cards can only activate through a chain');
    return { ...state, status: 'running', frontier: [index], phase: 0, moves: state.moves + (consumeMove?1:0), remainingMoves: state.remainingMoves-(consumeMove?1:0), lastEvent: null,
      chain: { activations: 0, destroyed: 0, spawned: 0, points: 0, phases: 0, peak: 0 } };
  }
  function begin(state,index) { return start(state,index,true); }
  function phaseScore(phase, count, destroyed) {
    const chainMultiplier = 1 + Math.max(0, phase - 1) * 0.5, burstMultiplier = 1 + Math.max(0, count - 1) * 0.25;
    const perCard = Math.round(BASE_POINTS * chainMultiplier * burstMultiplier);
    return { chainMultiplier, burstMultiplier, perCard, points: perCard * destroyed };
  }
  function itemTargets(state, index) {
    const type=state.board[index]?.item,row=Math.floor(index/state.size),column=index%state.size;
    if(type==='row')return Array.from({length:state.size},(_,c)=>row*state.size+c).filter(i=>i!==index);
    if(type==='column')return Array.from({length:state.size},(_,r)=>r*state.size+column).filter(i=>i!==index);
    if(type==='adjacent')return DIRS.flatMap((_,d)=>{const target=adjacent(index,d,state.size);return target<0?[]:[target];});
    return [];
  }
  function equip(state, slot, index) {
    if(state.status!=='idle')throw Error('Items can only be equipped between chains');
    if(!Number.isInteger(slot)||!ITEM_TYPES.includes(state.inventory?.[slot]))throw Error('Invalid inventory slot');
    if(!Number.isInteger(index)||!state.board[index]||state.board[index].item)throw Error('Choose a card without an item');
    const inventory=state.inventory.slice(),board=state.board.slice();
    board[index]={...board[index],item:inventory[slot]};inventory[slot]=null;
    return {...state,board,inventory,lastEvent:null};
  }
  function advance(state, allowRespawns) {
    if (state.status !== 'running') throw Error('No pending phase');
    const phase = state.phase + 1, board = state.board.slice(), queue = state.queue.slice(), respawns = allowRespawns ? state.respawns.slice() : Array(state.board.length).fill(null);
    const targets = new Set(), signals = [], links = [], linkKeys = new Set(), broken = [], brokenCards = [], filled = [], filledCards = [], itemEffects = [], itemRewards = [], bonusRewards = [], penaltyEffects = [];
    const inventory = (state.inventory || Array(INVENTORY_SIZE).fill(null)).slice();
    let rng = state.rng,queueRng=state.queueRng,itemRng = state.itemRng, remainingMoves = state.remainingMoves;
    // Destroyed at p, empty throughout p+1, and available before activation at p+2.
    respawns.forEach((pending,index)=>{
      if(pending && pending.at<=phase){const card=queue.shift();board[index]=card;respawns[index]=null;filled.push(index);filledCards.push({index,card,order:filled.length});}
    });
    while (queue.length < state.queue.length) { const roll = randomQueuedCard(rng,queueRng); rng = roll.rng;queueRng=roll.queueRng;queue.push(roll.card); }
    const active = [...new Set(state.frontier)].filter(i => board[i]).sort((a, b) => a - b);
    // Every activation emits its signal, then destroys the card immediately.
    for (const index of active) {
      const item=board[index].item;
      if(ITEM_TYPES.includes(item)){
        itemEffects.push({index,type:item});
        for(const target of itemTargets({...state,board},index)){
          const dr=Math.sign(Math.floor(target/state.size)-Math.floor(index/state.size)),dc=Math.sign(target%state.size-index%state.size);
          signals.push({from:index,to:target,direction:DIRS.findIndex(([r,c])=>r===dr&&c===dc),item});
        }
      }
      board[index].sides.forEach((out, direction) => {
        if (out !== true) return;
        const target = adjacent(index, direction, state.size);
        if (target >= 0) signals.push({ from: index, to: target, direction });
      });
    }
    if(allowRespawns)for(const index of active){
      if(board[index].mystery){
        const roll=random(itemRng),type=ITEM_TYPES[Math.floor(roll.value*ITEM_TYPES.length)],slot=inventory.indexOf(null);itemRng=roll.rng;
        if(slot>=0)inventory[slot]=type;
        itemRewards.push({index,type,slot,stored:slot>=0});
      }
      if(board[index].bonus){remainingMoves+=BONUS_VALUE;bonusRewards.push({index,amount:BONUS_VALUE});}
      if(board[index].penalty){remainingMoves-=PENALTY_VALUE;penaltyEffects.push({index,amount:PENALTY_VALUE});}
    }
    for (const index of active) {
      const card = board[index];
      broken.push(index); brokenCards.push({ index, card });board[index]=null;
      if (allowRespawns) respawns[index]={at:phase+RESPAWN_DELAY};
    }
    respawns.flatMap((pending,index)=>pending?[{...pending,index}]:[])
      .sort((a,b)=>a.at-b.at||a.index-b.index)
      .forEach((pending,order)=>{respawns[pending.index]={at:pending.at,card:queue[order]};});
    // Match live cards or cards due at the next phase, using the visible FIFO queue.
    for (const link of signals) {
      const target = board[link.to] || (respawns[link.to]?.at===phase+1?respawns[link.to].card:null);
      const key=`${link.from}:${link.to}`;
      if (target && (link.item || target.sides[(link.direction + 4) % 8] === false)) {
        targets.add(link.to);if(!linkKeys.has(key)){links.push(link);linkKeys.add(key);}
      }
    }
    const frontier = [...targets].sort((a, b) => a - b), scoring = phaseScore(phase, active.length, broken.length);
    const chain = { activations: state.chain.activations + active.length, destroyed: state.chain.destroyed + broken.length,
      spawned: state.chain.spawned + filled.length, points: state.chain.points + scoring.points, phases: phase, peak: Math.max(state.chain.peak, active.length) };
    return { ...state, board, queue, respawns, rng,queueRng, inventory, itemRng, remainingMoves, phase, frontier, status: frontier.length || respawns.some(Boolean) ? 'running' : 'settling', chain,
      score: state.score + scoring.points, destroyed: state.destroyed + broken.length,
      bestChain: Math.max(state.bestChain, phase), bestBurst: Math.max(state.bestBurst, active.length),
      lastEvent: { phase, active, links, broken, brokenCards, rotations: [], filled, filledCards, itemEffects, itemRewards, bonusRewards, penaltyEffects, next: frontier, ...scoring } };
  }
  function step(state) { return advance(state, true); }
  function complete(state) {
    if (state.status !== 'settling' || state.respawns.some(Boolean)) throw Error('Chain still has pending phases');
    const alive=state.remainingMoves>0,filled=alive?placeSpecials(state,true):{board:state.board,markerRng:state.markerRng,markersAdded:[]};
    return { ...state, board:filled.board,markerRng:filled.markerRng,remainingMoves:Math.max(0,state.remainingMoves),status:alive?'idle':'gameover',frontier:[],
      lastEvent:{type:'complete',markersAdded:filled.markersAdded} };
  }
  function connections(state, index) {
    const card = state.board[index];
    if (!card) return [];
    const linked=card.sides.flatMap((out, direction) => {
      const target = adjacent(index, direction, state.size);
      return out === true && target >= 0 && state.board[target] && state.board[target].sides[(direction + 4) % 8] === false ? [target] : [];
    });
    return [...new Set([...linked,...itemTargets(state,index).filter(i=>state.board[i])])];
  }
  function preview(state, index) {
    let simulation = start(state, index, false);
    const phases = [], visits = new Map(), paths = new Map();
    while (simulation.status === 'running' && simulation.phase < PREVIEW_PHASE_LIMIT) {
      simulation = advance(simulation, false);
      const event = simulation.lastEvent;
      phases.push(event);
      for (const cardIndex of event.active) {
        if (!visits.has(cardIndex)) visits.set(cardIndex, { index: cardIndex, phases: [], destroyedAt: null });
        const visit = visits.get(cardIndex);
        visit.phases.push(event.phase);
        if (event.broken.includes(cardIndex)) visit.destroyedAt = event.phase;
      }
      for (const link of event.links) {
        const key = `${link.from}:${link.to}`;
        if (!paths.has(key)) paths.set(key, { ...link, phases: [] });
        paths.get(key).phases.push(event.phase);
      }
    }
    // Forecast only the cards currently on the field; never replace destroyed cards.
    return { source: index, events: phases, cards: [...visits.values()], links: [...paths.values()], complete: simulation.status !== 'running', ...simulation.chain };
  }
  const api = { SIZE, BASE_POINTS, ROTATION_ENABLED, RESPAWN_DELAY, PREVIEW_PHASE_LIMIT, MIN_ARROWS, MAX_ARROWS, QUEUE_SIZE, QUEUE_MYSTERY_CHANCE, ITEM_TYPES, INVENTORY_SIZE, INITIAL_MOVES, BONUS_BATCH_SIZE, BONUS_VALUE, MYSTERY_BATCH_SIZE, PENALTY_BATCH_SIZE, PENALTY_VALUE, DIFFICULTY_RAMP_STAGES, ARROW_COUNT_WEIGHTS, DIRECTION_NAMES, create, begin, step, complete, adjacent, rotate, phaseScore, connections, itemTargets, equip, randomCard, randomQueuedCard, profile, stageDifficulty, isSpecial, preview };
  if (typeof module !== 'undefined') module.exports = api; else root.Octago = api;
})(globalThis);
