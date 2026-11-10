const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine.js');
const blank=item=>({sides:Array(8).fill(null),...(item?{item}:{})});
const field=()=>({...E.create('items',3),board:Array.from({length:9},()=>blank())});
const mysteryAtStart=seed=>{const s=E.create(seed);s.board=s.board.map(({mystery,bonus,penalty,penaltyMode,...card},index)=>index===0?{...card,mystery:true}:index===1?{...card,item:'row'}:card);return s;};

test('each item activates its whole range regardless of arrow directions',()=>{
  for(const [type,expected] of [['row',[3,5]],['column',[1,7]],['adjacent',[0,1,2,3,5,6,7,8]]]){
    const s=field();s.board[4]=blank(type);const before=JSON.stringify(s),p1=E.step(E.begin(s,4));
    assert.deepEqual(p1.frontier,expected);assert.equal(p1.lastEvent.links.length,expected.length);assert(p1.lastEvent.links.every(link=>link.item===type));
    assert.deepEqual(p1.lastEvent.itemEffects,[{index:4,type}]);assert.deepEqual(E.step(p1).lastEvent.active,expected);assert.equal(JSON.stringify(s),before);
  }
  const corner=field();corner.board[0]=blank('adjacent');assert.deepEqual(E.step(E.begin(corner,0)).frontier,[1,3,4]);
});
test('items add to arrows, deduplicate targets, and trigger other item cards',()=>{
  const s=field();s.board[4]=blank('row');s.board[4].sides[0]=true;s.board[1].sides[4]=false;s.board[3]=blank('column');
  const p1=E.step(E.begin(s,4));assert.deepEqual(p1.frontier,[1,3,5]);
  const p2=E.step(p1);assert.deepEqual(p2.frontier,[0,6]);assert.deepEqual(p2.lastEvent.itemEffects,[{index:3,type:'column'}]);
  const multi=field();multi.board[3]=blank('row');multi.board[1]=blank('column');
  const simultaneous=E.step({...E.begin(multi,3),frontier:[1,3,4]});assert(!simultaneous.frontier.includes(4));assert.equal(new Set(simultaneous.frontier).size,simultaneous.frontier.length);
});
test('item signals can trigger a due replacement but previews exclude replacements',()=>{
  let s=field();s.board[3]=blank('row');s.board[4]=null;s=E.begin(s,3);s.phase=1;s.queue[0]=blank();s.respawns[4]={at:3,card:s.queue[0]};
  const p2=E.step(s);assert(p2.frontier.includes(4));const p3=E.step(p2);assert(p3.lastEvent.filled.includes(4));assert(p3.lastEvent.active.includes(4));
  const original=field();original.board[4]=blank('row');const before=JSON.stringify(original),preview=E.preview(original,4);
  assert.equal(preview.spawned,0);assert.equal(preview.itemRewards,undefined);assert(preview.events.every(event=>event.itemRewards.length===0));assert.equal(JSON.stringify(original),before);
});
test('a mystery card awards one deterministic item and consumes its marker',()=>{
  const types=new Set();for(let seed=0;seed<60;seed++){
    const s=mysteryAtStart(seed);assert.deepEqual(s.inventory,[null,null,null]);
    const before=JSON.stringify(s),p=E.step(E.step(E.begin(s,1))),reward=p.lastEvent.itemRewards[0];
    assert.equal(p.lastEvent.itemRewards.length,1);assert(reward.stored);assert.equal(reward.slot,0);assert.equal(p.inventory[0],reward.type);types.add(reward.type);
    assert(p.board.every(card=>!card?.mystery));assert.equal(p.rng,s.rng);assert.equal(JSON.stringify(s),before);
    assert.deepEqual(E.step(E.step(E.begin(s,1))),p);
  }
  assert.deepEqual([...types].sort(),[...E.ITEM_TYPES].sort());
});
test('full inventory preserves existing items and wiped mystery cards do not return on refill',()=>{
  const s={...mysteryAtStart('full-items'),inventory:['row','column','adjacent']};const p=E.step(E.step(E.begin(s,1)));
  assert.deepEqual(p.inventory,s.inventory);assert.equal(p.lastEvent.itemRewards[0].stored,false);
  const all=mysteryAtStart('all-empty');const p1=E.step({...E.begin(all,1),frontier:Array.from({length:64},(_,i)=>i)});
  assert(p1.board.every(card=>card===null));assert.equal(p1.lastEvent.itemRewards.length,1);
  const p2=E.step(p1),p3=E.step(p2);assert.deepEqual(p3.board,all.queue);assert(p3.board.every(card=>card&&(!card.mystery||card.persistentMystery)));
});
test('equipping consumes one slot only during the selection turn and never activates the card',()=>{
  const s={...E.create('equip'),inventory:['row','column','adjacent']};s.board[0]={...s.board[0],mystery:true};const before=JSON.stringify(s),next=E.equip(s,1,0);
  assert.equal(next.board[0].item,'column');assert(next.board[0].mystery);assert.deepEqual(next.inventory,['row',null,'adjacent']);assert.equal(next.moves,0);assert.equal(next.remainingMoves,E.INITIAL_MOVES);assert.equal(next.status,'idle');assert.equal(next.score,0);assert.equal(next.itemRng,s.itemRng);assert.equal(JSON.stringify(s),before);
  const source=s.board.findIndex(card=>!E.isSpecial(card));assert.throws(()=>E.equip(next,0,0));assert.throws(()=>E.equip(next,1,0));assert.throws(()=>E.equip(E.begin(s,source),0,1));assert.throws(()=>E.equip(s,-1,0));assert.throws(()=>E.equip(s,0,64));
});
