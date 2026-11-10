const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine.js');
const blank=()=>({sides:Array(8).fill(null)});
const rare=()=>({...blank(),mystery:true,persistentMystery:true});
function field(){const s=E.create('persistent-rules');return {...s,board:Array.from({length:64},blank),queue:Array.from({length:64},blank),remainingMoves:8};}
function finish(s){let ticks=0;while(s.status==='running'){s=E.step(s);assert(++ticks<1000);}return E.complete(s);}
function stageCounts(s){assert.deepEqual(['bonus','mystery','penalty'].map(type=>s.board.filter(card=>card[type]&&!card.persistentMystery).length),[3,1,2]);}

test('new queued cards have a three-percent persistent mystery chance without changing arrow generation',()=>{
  assert.equal(E.QUEUE_MYSTERY_CHANCE,.03);let rng=1234,queueRng=5678,count=0;
  for(let i=0;i<30000;i++){
    const ordinary=E.randomCard(rng),queued=E.randomQueuedCard(rng,queueRng);assert.deepEqual(queued.card.sides,ordinary.card.sides);assert.equal(queued.rng,ordinary.rng);
    assert.equal(Boolean(queued.card.mystery),Boolean(queued.card.persistentMystery));assert(!queued.card.bonus&&!queued.card.penalty);if(queued.card.persistentMystery)count++;
    rng=queued.rng;queueRng=queued.queueRng;
  }
  assert(Math.abs(count/30000-.03)<.004);
  let initial=0;for(let seed=0;seed<40;seed++){const s=E.create('initial-'+seed);assert(s.board.every(card=>!card.persistentMystery));initial+=s.queue.filter(card=>card.persistentMystery).length;}
  assert(initial>0);
});

test('a queued mystery enters the field in FIFO order and keeps its position and equipped item across stages',()=>{
  let s=field();const card=rare();s.queue[0]=card;const before=JSON.stringify(s),first=finish(E.begin(s,0));assert.equal(JSON.stringify(s),before);assert.equal(first.board[0],card);stageCounts(first);
  assert.throws(()=>E.begin(first,0),/only activate through a chain/);assert.throws(()=>E.preview(first,0),/only activate through a chain/);
  s=E.equip({...first,inventory:['row',null,null]},0,0);const equipped=s.board[0];
  for(let stage=0;stage<3;stage++){
    const source=s.board.findIndex(card=>!E.isSpecial(card)&&card.sides.every(side=>side===null));assert(source>0);const itemRng=s.itemRng;
    s=finish(E.begin(s,source));assert.equal(s.board[0],equipped);assert.equal(s.board[0].item,'row');assert.equal(s.itemRng,itemRng);stageCounts(s);
    assert.equal(s.board.filter(card=>card.persistentMystery).length,1);assert(s.lastEvent.markersAdded.every(mark=>mark.index!==0));
  }
});

test('a persistent mystery awards an item only when chained, and is consumed on destruction',()=>{
  const s=field();s.board[0].sides[2]=true;s.board[1]=rare();s.board[1].sides[6]=false;
  const p1=E.step(E.begin(s,0));assert.equal(p1.inventory.filter(Boolean).length,0);assert.deepEqual(p1.frontier,[1]);
  const p2=E.step(p1);assert.equal(p2.board[1],null);assert.equal(p2.lastEvent.itemRewards.length,1);assert.equal(p2.lastEvent.itemRewards[0].index,1);assert.equal(p2.inventory.filter(Boolean).length,1);
  const done=finish(p2);assert(!done.board[1].persistentMystery);assert.equal(done.inventory.filter(Boolean).length,1);assert.equal(done.remainingMoves,7);stageCounts(done);
});

test('a persistent queued card can be chained on its birth phase, while preview excludes it',()=>{
  const base=field();base.board[3].item='row';base.board[4]=null;base.queue[0]=rare();
  const preview=E.preview(base,3);assert(!preview.cards.some(card=>card.index===4));assert(preview.events.every(event=>event.itemRewards.length===0));
  let s=E.begin(base,3);s={...s,phase:1,respawns:s.respawns.map((pending,index)=>index===4?{at:3,card:s.queue[0]}:pending)};
  const p2=E.step(s);assert(p2.frontier.includes(4));const p3=E.step(p2);
  assert(p3.lastEvent.filled.includes(4));assert(p3.lastEvent.broken.includes(4));assert(p3.lastEvent.itemRewards.some(reward=>reward.index===4));assert.equal(p3.inventory.filter(Boolean).length,1);
});

test('queue refills use the persistent mystery roll and restore all random streams deterministically',()=>{
  const s=field();const p1=E.step(E.begin(s,0)),p2=E.step(p1),p3=E.step(p2),expected=E.randomQueuedCard(s.rng,s.queueRng);
  assert.equal(p2.queueRng,s.queueRng);assert.deepEqual(p3.queue.at(-1),expected.card);assert.equal(p3.queueRng,expected.queueRng);assert.equal(p3.rng,expected.rng);
  assert.equal(p3.itemRng,s.itemRng);assert.equal(p3.markerRng,s.markerRng);assert.deepEqual(E.step(E.step(E.step(E.begin(s,0)))),p3);
});
