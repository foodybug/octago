const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine.js');
const types=['bonus','mystery','penalty'];
const blank=()=>({sides:Array(8).fill(null)});
const field=()=>({...E.create('turn-rules'),board:Array.from({length:64},blank)});
function finish(s){let ticks=0;while(s.status==='running'){s=E.step(s);assert(++ticks<5000);}return E.complete(s);}
function markers(s,type){return s.board.flatMap((card,i)=>card?.[type]&&!card.persistentMystery?[i]:[]);}
function assertCounts(s){assert.deepEqual(types.map(type=>markers(s,type).length),[3,1,2]);assert(s.board.every(card=>types.filter(type=>card[type]).length<=1));for(const mode of ['random','difficulty'])assert.equal(s.board.filter(card=>card.penalty&&card.penaltyMode===mode).length,1);}

test('the first stage starts with three moves and all six distinct special cards',()=>{
  for(let seed=0;seed<30;seed++){const s=E.create(seed);assert.equal(s.remainingMoves,3);assert.equal(s.moves,0);assertCounts(s);assert.deepEqual(s,E.create(seed));assert(s.board.every(card=>!card.persistentMystery));assert(s.queue.every(card=>!card.bonus&&!card.penalty&&(!card.mystery||card.persistentMystery)));}
});

test('every stage rerolls all six special cards after any type is activated',()=>{
  let s=E.create('persistent-markers');s={...s,board:s.board.map(card=>({...card,sides:Array(8).fill(null)})),remainingMoves:20};
  for(const type of ['bonus','mystery','penalty','bonus','mystery']){
    const index=markers(s,type)[0],before=JSON.stringify(s),old=s;
    const source=s.board.findIndex(card=>!E.isSpecial(card));
    s=finish({...E.begin(s,source),frontier:[index]});assert.equal(JSON.stringify(old),before);assertCounts(s);
    assert.deepEqual(s.lastEvent.markersAdded.map(mark=>mark.type).sort(),['bonus','bonus','bonus','mystery','penalty','penalty']);
    old.board.forEach((card,i)=>{if(i!==index){assert.equal(s.board[i].sides,card.sides);assert.equal(s.board[i].item,card.item);if(card.persistentMystery)assert.equal(s.board[i],card);else for(const type of types)if(card[type])assert(!s.board[i][type]);}});
    assert.equal(s.itemRng,old.itemRng+(type==='mystery'?0x6D2B79F5:0)>>>0);
  }
});

test('an untouched stage relocates every special without awarding anything or moving equipped items',()=>{
  let s=E.create('quiet');s=E.equip({...s,inventory:['row',null,null]},0,markers(s,'bonus')[0]);
  const board=s.board.map(card=>({...card,sides:Array(8).fill(null)})),index=board.findIndex(card=>types.every(type=>!card[type]));
  const done=finish(E.begin({...s,board},index));assertCounts(done);assert.equal(done.lastEvent.markersAdded.length,6);assert.notEqual(done.markerRng,s.markerRng);
  for(const type of types)for(const i of markers(s,type))assert(!done.board[i][type]);
  board.forEach((card,i)=>{if(i!==index){assert.equal(done.board[i].sides,card.sides);assert.equal(done.board[i].item,card.item);}});
  assert.equal(done.remainingMoves,s.remainingMoves-1);assert.deepEqual(done.inventory,s.inventory);assert.equal(done.itemRng,s.itemRng);
});

test('chain activations consume only the selection cost and replenish every stage',()=>{
  const s=field();s.board[0]={...blank(),item:'row'};const next=finish(E.begin(s,0));
  assert.equal(next.moves,1);assert.equal(next.remainingMoves,E.INITIAL_MOVES-1);assert.equal(next.chain.activations,8);assertCounts(next);assert.equal(next.lastEvent.markersAdded.length,6);
});

test('chained penalty cards each subtract one move and score normally',()=>{
  const s={...E.create('penalty',3),board:Array.from({length:9},blank),remainingMoves:5};s.board[4]={...blank(),item:'row'};s.board[3].penalty=true;s.board[5].penalty=true;
  const first=E.step(E.begin(s,4));assert.equal(first.remainingMoves,4);assert.deepEqual(first.lastEvent.penaltyEffects,[]);assert.equal(first.lastEvent.points,100);
  const second=E.step(first);assert.equal(second.remainingMoves,2);assert.deepEqual(second.lastEvent.penaltyEffects,[{index:3,amount:1},{index:5,amount:1}]);assert(second.lastEvent.points>0);
});

test('simultaneous plus and minus cards are additive and independent of activation order',()=>{
  const s={...E.create('mixed',3),board:Array.from({length:9},blank),remainingMoves:1};
  s.board[4].item='row';s.board[3].bonus=true;s.board[5].penalty=true;
  const first=E.step(E.begin(s,4));assert.equal(first.remainingMoves,0);
  const second=E.step(first),reversed=E.step({...first,frontier:[5,3]});assert.deepEqual(second,reversed);assert.equal(second.remainingMoves,0);
  assert.deepEqual(second.lastEvent.bonusRewards,[{index:3,amount:1}]);assert.deepEqual(second.lastEvent.penaltyEffects,[{index:5,amount:1}]);assert.equal(finish(second).status,'gameover');
});

test('negative move totals stay signed through a chain, with game over evaluated only at completion',()=>{
  const s=field();s.remainingMoves=1;s.board[0].sides[2]=true;s.board[1]={...blank(),penalty:true};s.board[1].sides[6]=false;s.board[1].sides[2]=true;s.board[2]={...blank(),item:'row',bonus:true};s.board[2].sides[6]=false;s.board[3].bonus=true;
  const first=E.step(E.step(E.begin(s,0)));assert.equal(first.remainingMoves,-1);assert.equal(first.status,'running');
  const second=E.step(first);assert.equal(second.remainingMoves,0);assert.equal(second.status,'running');
  const done=finish(second);assert.equal(done.remainingMoves,1);assert.equal(done.status,'idle');assertCounts(done);
  const lost=field();lost.remainingMoves=1;lost.board[0].sides[2]=true;lost.board[1].penalty=true;lost.board[1].sides[6]=false;const over=finish(E.begin(lost,0));assert.equal(over.remainingMoves,0);assert.equal(over.status,'gameover');assert.deepEqual(over.lastEvent.markersAdded,[]);
  assert.throws(()=>E.begin(over,0));assert.throws(()=>E.equip({...over,inventory:['row',null,null]},0,0));
});

test('preview never spends moves, awards rewards, or changes special cards and their random streams',()=>{
  const s=field();s.board[0]={...blank(),item:'row'};s.board[1].bonus=true;s.board[2].penalty=true;s.board[3].mystery=true;
  const before=JSON.stringify(s),preview=E.preview(s,0);assert.equal(JSON.stringify(s),before);assert(preview.events.every(e=>!e.bonusRewards.length&&!e.itemRewards.length&&!e.penaltyEffects.length));
  assert(preview.cards.some(card=>card.index===1));assert(preview.cards.some(card=>card.index===2));
});

test('special cards reject direct activation and preview even with an equipped item',()=>{
  for(const type of types)for(const item of [undefined,'row']){
    const s=field();s.board[0]={...blank(),[type]:true,...(item?{item}:{})};const before=JSON.stringify(s);
    assert(E.isSpecial(s.board[0]));assert.throws(()=>E.begin(s,0),/only activate through a chain/);assert.throws(()=>E.preview(s,0),/only activate through a chain/);assert.equal(JSON.stringify(s),before);
    s.board[1]={...blank(),item:'row'};const p1=E.step(E.begin(s,1));assert(p1.frontier.includes(0));const p2=E.step(p1);assert(p2.lastEvent.broken.includes(0));
    if(type==='bonus')assert.equal(p2.lastEvent.bonusRewards[0].amount,1);
    if(type==='penalty')assert.equal(p2.lastEvent.penaltyEffects[0].amount,1);
    if(type==='mystery')assert.equal(p2.lastEvent.itemRewards.length,1);
  }
});

test('difficulty progressively separates rewards and brings penalties closer to rewards',()=>{
  assert.equal(E.stageDifficulty(1),0);assert.equal(E.stageDifficulty(20),1);assert.equal(E.stageDifficulty(200),1);
  const totals=Array.from({length:3},()=>({rewards:0,penalties:0}));
  for(let seed=0;seed<100;seed++){
    const base=E.create('distance-'+seed),board=base.board.map(card=>({sides:card.sides}));
    for(const [n,moves] of [0,9,19].entries()){
      const s=E.complete({...base,board,moves,status:'settling'});assertCounts(s);
      const distance=(a,b)=>Math.max(Math.abs(Math.floor(a/8)-Math.floor(b/8)),Math.abs(a%8-b%8)),mystery=markers(s,'mystery')[0],bonuses=markers(s,'bonus'),rewards=[mystery,...bonuses];
      totals[n].rewards+=bonuses.reduce((sum,i)=>sum+distance(i,mystery),0)/3;
      const weighted=s.board.findIndex(card=>card.penaltyMode==='difficulty');totals[n].penalties+=Math.min(...rewards.map(j=>distance(weighted,j)));
      assert.equal(s.rng,base.rng);assert.equal(s.itemRng,base.itemRng);
    }
  }
  assert(totals[0].rewards<totals[1].rewards&&totals[1].rewards<totals[2].rewards);
  assert(totals[0].penalties>totals[1].penalties&&totals[1].penalties>totals[2].penalties);
  assert(totals[2].rewards-totals[0].rewards>200);assert(totals[0].penalties-totals[2].penalties>200);
});

test('the uniformly random penalty is selected independently of stage difficulty',()=>{
  const locations=new Set();
  for(let seed=0;seed<100;seed++){
    const base=E.create('uniform-'+seed),uniform=[];
    for(const moves of [0,9,19,99]){
      const s=E.complete({...base,moves,status:'settling'});assertCounts(s);
      const index=s.board.findIndex(card=>card.penaltyMode==='random');uniform.push(index);locations.add(index);
    }
    assert(uniform.every(index=>index===uniform[0]));
  }
  assert(locations.size>40);
});

test('small boards place only as many non-overlapping specials as they can hold',()=>{
  for(const size of [1,2,3]){const s=E.create('small',size);assert.equal(s.board.length,size*size);assert(s.board.every(card=>types.filter(type=>card[type]).length<=1));for(const [type,max] of [['bonus',3],['mystery',1],['penalty',2]])assert(markers(s,type).length<=max);}
});
