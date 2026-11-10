const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine.js');
const card=(outs=[0,2])=>({sides:Array.from({length:8},(_,d)=>outs.includes(d))});
const field=()=>({...E.create('test',3),board:Array(9).fill(null)});
function finish(s){let ticks=0;while(s.status==='running'){s=E.step(s);assert(++ticks<5000);}return s;}
function respawnFixture(inward=true){let s=field();s.board[3]=card([0,2]);s.board[1]=card([0,2]);s=E.begin(s,3);s.phase=1;s.queue[0]=card(inward?[0,2]:[0,6]);s.respawns[4]={at:3,card:s.queue[0]};return s;}

test('field and queue cards have five to eight arrows with both inward and outward sides',()=>{
  assert.equal(E.MIN_ARROWS,5);assert.equal(E.MAX_ARROWS,8);assert.deepEqual(E.create('a'),E.create('a'));assert.notDeepEqual(E.create('a').board,E.create('b').board);
  const counts=new Set(),tones=new Set();for(let seed=0;seed<100;seed++){const s=E.create(seed);for(const c of [...s.board,...s.queue]){const p=E.profile(c);assert.equal(c.sides.length,8);assert(c.sides.every(v=>v===null||typeof v==='boolean'));assert(p.total>=5&&p.total<=8);assert(p.out>=1&&p.inward>=1);assert.equal(p.absent,8-p.total);counts.add(p.total);tones.add(p.tone);}}
  assert.deepEqual([...counts].sort(),[5,6,7,8]);assert.deepEqual([...tones].sort(),['blue','neutral','yellow']);
});
test('arrow counts are equally likely and placement and inward/outward directions are random',()=>{
  const n=100000,counts=Array(4).fill(0),occupied=Array(8).fill(0),outward=Array(8).fill(0),minorities=new Set();let rng=12345;
  for(let i=0;i<n;i++){const r=E.randomCard(rng);rng=r.rng;const p=E.profile(r.card);assert(p.total>=5&&p.total<=8);assert(p.out>=1&&p.inward>=1);counts[p.total-5]++;if(p.out===1||p.inward===1)minorities.add(p.total);r.card.sides.forEach((out,d)=>{if(out!==null){occupied[d]++;if(out)outward[d]++;}});}
  counts.forEach(count=>assert(Math.abs(count/n-.25)<.005));occupied.forEach(count=>assert(Math.abs(count/n-6.5/8)<.006));outward.forEach((count,d)=>assert(Math.abs(count/occupied[d]-.5)<.006));assert.deepEqual([...minorities].sort(),[5,6,7,8]);
});
test('tone follows the majority with a neutral four-four tie',()=>{
  assert.deepEqual(E.profile(card([0,1,2,3,4,5])),{out:6,inward:2,total:8,absent:0,tone:'blue'});
  assert.deepEqual(E.profile(card([0,2])),{out:2,inward:6,total:8,absent:0,tone:'yellow'});
  assert.deepEqual(E.profile(card([0,2,4,6])),{out:4,inward:4,total:8,absent:0,tone:'neutral'});
  assert.deepEqual(E.profile({sides:[true,null,false,null,false,null,null,null]}),{out:1,inward:2,total:3,absent:5,tone:'yellow'});
});
test('8-direction adjacency is clockwise and cannot wrap field edges',()=>{
  assert.deepEqual(Array.from({length:8},(_,d)=>E.adjacent(36,d)),[28,29,37,45,44,43,35,27]);
  assert.deepEqual(Array.from({length:8},(_,d)=>E.adjacent(0,d)),[-1,-1,1,9,8,-1,-1,-1]);
  assert.deepEqual(Array.from({length:8},(_,d)=>E.adjacent(63,d)),[55,-1,-1,-1,-1,-1,62,54]);assert.equal(E.adjacent(7,1),-1);assert.equal(E.adjacent(8,7),-1);
});
test('all eight directions require an inward opposite arrow',()=>{
  for(let d=0;d<8;d++){const target=E.adjacent(4,d,3),s=field();s.board[4]=card([d,(d+1)%8]);s.board[target]=card([(d+1)%8,(d+2)%8]);
    assert.deepEqual(E.connections(s,4),[target]);const next=E.step(E.begin(s,4));assert.deepEqual(next.frontier,[target]);assert.deepEqual(next.lastEvent.broken,[4]);assert.deepEqual(E.step(next).lastEvent.broken,[target]);
    s.board[target]=card([(d+4)%8,(d+5)%8]);assert.deepEqual(E.connections(s,4),[]);assert.deepEqual(E.step(E.begin(s,4)).frontier,[]);
  }
});
test('diagonal signals do not require orthogonal neighbors',()=>{const s=field();s.board[4]=card([1,2]);s.board[2]=card([0,2]);assert.deepEqual(E.step(E.begin(s,4)).frontier,[2]);});
test('absent receiving directions are not inward arrows and absent sources never emit',()=>{
  for(let d=0;d<8;d++){const s=field(),target=E.adjacent(4,d,3);s.board[4]=card([d]);s.board[target]={sides:Array(8).fill(null)};
    assert.deepEqual(E.connections(s,4),[]);assert.deepEqual(E.step(E.begin(s,4)).frontier,[]);s.board[target].sides[(d+4)%8]=false;s.board[4].sides[d]=null;assert.deepEqual(E.step(E.begin(s,4)).frontier,[]);
  }
});
test('a click schedules one source and invalid transitions are rejected',()=>{
  const s=E.create(),before=JSON.stringify(s),n=E.begin(s,36);assert.deepEqual(n.frontier,[36]);assert.equal(n.moves,1);assert.equal(JSON.stringify(s),before);
  [-1,64,1.5].forEach(i=>assert.throws(()=>E.begin(s,i)));assert.throws(()=>E.begin(n,0));assert.throws(()=>E.step(s));assert.throws(()=>E.complete(s));
});
test('old cards emit before destruction and replacement',()=>{
  const s=field();s.board[4]=card([0,2]);s.board[5]=card([0,2]);const p1=E.step(E.begin(s,4));assert.equal(p1.board[4],null);assert.deepEqual(p1.lastEvent.brokenCards,[{index:4,card:s.board[4]}]);assert.deepEqual(p1.frontier,[5]);assert.equal(E.step(p1).score,250);
});
test('multiple signals deduplicate a target',()=>{
  const s=field();s.board[0]=card([0,3]);s.board[1]=card([0,4]);s.board[4]=card([2,3]);const next=E.step({...E.begin(s,0),frontier:[0,1,0]});assert.deepEqual(next.lastEvent.active,[0,1]);assert.deepEqual(next.frontier,[4]);assert.deepEqual(E.step(next).lastEvent.broken,[4]);
});
test('simultaneous destruction is independent of frontier order',()=>{
  const s=field();s.board[3]=card([0,2]);s.board[4]=card([0,2]);const a=E.step({...E.begin(s,3),frontier:[3,4]}),b=E.step({...E.begin(s,3),frontier:[4,3]});assert.deepEqual(a,b);assert.deepEqual(a.frontier,[]);
});
test('a destroyed card stays empty at p+1 and returns at p+2',()=>{
  const s=field();s.board[0]=card([0,7]);const p1=E.step(E.begin(s,0));assert.equal(p1.board[0],null);assert.equal(p1.respawns[0].at,3);assert.deepEqual(p1.queue,s.queue);
  const p2=E.step(p1);assert.equal(p2.board[0],null);assert.deepEqual(p2.lastEvent.filled,[]);
  const p3=E.step(p2);assert.deepEqual(p3.board[0],s.queue[0]);assert.deepEqual(p3.lastEvent.filled,[0]);assert.equal(E.complete(p3).status,'idle');
});
test('due cards consume the visible queue in row order and automatically refill it',()=>{
  const s=field();[0,4,8].forEach(i=>s.board[i]=card([0,7]));const before=JSON.stringify(s),p1=E.step({...E.begin(s,0),frontier:[8,0,4]});assert.deepEqual(p1.lastEvent.broken,[0,4,8]);assert.deepEqual(p1.queue,s.queue);
  [0,4,8].forEach((i,order)=>assert.deepEqual(p1.respawns[i].card,s.queue[order]));const p2=E.step(p1);assert.deepEqual(p2.lastEvent.filled,[]);const p3=E.step(p2);assert.deepEqual(p3.lastEvent.filled,[0,4,8]);
  [0,4,8].forEach((i,order)=>{assert.deepEqual(p3.board[i],s.queue[order]);assert.deepEqual(p3.lastEvent.filledCards[order],{index:i,card:s.queue[order],order:order+1});});assert.equal(p3.queue.length,E.QUEUE_SIZE);assert.deepEqual(p3.queue.slice(0,-3),s.queue.slice(3));assert.equal(JSON.stringify(s),before);
});
test('scheduled spawn phases take precedence over row order between phases',()=>{
  const s=field();s.board[0]=card([0,7]);s.board[8]=card([0,7]);const p1=E.step(E.begin(s,8)),p2=E.step({...p1,frontier:[0]});assert.deepEqual(p2.respawns[8].card,s.queue[0]);assert.deepEqual(p2.respawns[0].card,s.queue[1]);const p3=E.step(p2);assert.deepEqual(p3.lastEvent.filled,[8]);const p4=E.step(p3);assert.deepEqual(p4.lastEvent.filled,[0]);assert.deepEqual(p4.board[0],s.queue[1]);
});
test('a full-field destruction refills the entire field after the waiting phase',()=>{
  const s=E.create('full-refill'),p1=E.step({...E.begin(s,0),frontier:Array.from({length:64},(_,i)=>63-i)});assert(p1.board.every(c=>c===null));const p3=E.step(E.step(p1));assert.deepEqual(p3.board,s.queue);assert.equal(p3.queue.length,E.QUEUE_SIZE);assert.equal(p3.status,'settling');
});
test('a due replacement can activate and shatter on its spawn phase',()=>{
  const p2=E.step(respawnFixture());assert.equal(p2.board[4],null);assert.deepEqual(p2.frontier,[4]);const p3=E.step(p2);assert.deepEqual(p3.lastEvent.filled,[4]);assert.deepEqual(p3.lastEvent.broken,[4]);assert.equal(p3.respawns[4].at,5);assert.deepEqual(p3.frontier,[1]);
});
test('an outward receiving side cannot trigger a due replacement',()=>{const p2=E.step(respawnFixture(false));assert.deepEqual(p2.frontier,[]);const p3=E.step(p2);assert(p3.board[4]);assert.deepEqual(p3.lastEvent.active,[]);});
test('signals are not stored through an extra empty phase',()=>{const s=respawnFixture();s.respawns[4].at=4;const p2=E.step(s);assert.deepEqual(p2.frontier,[]);const p3=E.step(p2);assert.equal(p3.board[4],null);assert.deepEqual(E.step(p3).lastEvent.active,[]);});
test('a diagonal path finishes after all final replacements arrive',()=>{
  const s=field();s.board[0]=card([0,3]);s.board[4]=card([2,3]);s.board[8]=card([2,4]);const done=finish(E.begin(s,0));assert.equal(done.score,450);assert.equal(done.chain.destroyed,3);assert.equal(done.chain.spawned,3);assert.equal(done.phase,5);
});
test('phase score rewards simultaneous destruction and depth',()=>{assert.equal(E.phaseScore(1,1,1).points,100);assert.equal(E.phaseScore(2,3,3).points,675);assert.equal(E.phaseScore(3,0,0).points,0);});
test('preview stops at current cards and excludes paths opened by replacements',()=>{
  const s=field(),sparse=(outward,inward)=>({sides:Array.from({length:8},(_,d)=>outward.includes(d)?true:inward.includes(d)?false:null)});
  s.board[0]=sparse([2],[3]);s.board[1]=sparse([4],[6]);s.board[4]=sparse([7],[0]);s.board[3]=sparse([],[0]);s.queue[0]=sparse([4],[3]);
  const before=JSON.stringify(s),p=E.preview(s,0),done=finish(E.begin(s,0));
  assert.equal(JSON.stringify(s),before);assert(p.complete);assert.equal(p.phases,3);assert.equal(p.points,450);assert.equal(p.spawned,0);
  assert.deepEqual(p.cards.map(c=>c.index),[0,1,4]);assert.deepEqual(p.links.map(l=>[l.from,l.to]),[[0,1],[1,4]]);assert(p.events.every(e=>e.filled.length===0));
  assert.equal(done.chain.points,1000);assert.equal(done.chain.destroyed,5);
  const otherQueue={...s,queue:E.create('other').queue,rng:0};assert.deepEqual(E.preview(otherQueue,0),p);
});
test('seeded chains preserve the field and queue, while previews visit only original cards once',()=>{
  for(let seed=0;seed<100;seed++){const base=E.create(seed),index=Array.from({length:64},(_,offset)=>(seed*17+offset)%64).find(i=>!E.isSpecial(base.board[i])),preview=E.preview(base,index);let s=E.begin(base,index);
    while(s.status==='running'&&s.phase<E.PREVIEW_PHASE_LIMIT){const old=s;s=E.step(s);assert.equal(s.board.filter(Boolean).length+s.respawns.filter(Boolean).length,64);assert.deepEqual(s.lastEvent.active,s.lastEvent.broken);assert(s.frontier.every(i=>s.board[i]||s.respawns[i]?.at===s.phase+1));assert.equal(s.queue.length,E.QUEUE_SIZE);
      s.lastEvent.filledCards.forEach((filled,order)=>assert.deepEqual(filled.card,old.queue[order]));const pending=s.respawns.flatMap((r,i)=>r?[{...r,index:i}]:[]).sort((a,b)=>a.at-b.at||a.index-b.index);pending.forEach((r,order)=>assert.deepEqual(r.card,s.queue[order]));for(let i=0;i<64;i++){if(s.board[i]){const p=E.profile(s.board[i]);assert.equal(s.board[i].sides.length,8);assert(p.total>=5&&p.total<=8);assert(p.out>=1&&p.inward>=1);}if(old.respawns[i]&&old.respawns[i].at>s.phase)assert.equal(s.board[i],null);}
    }
    assert(preview.complete);assert.equal(preview.spawned,0);assert.equal(preview.activations,preview.cards.length);assert(preview.phases<=64);
    const seen=new Set();for(const event of preview.events){assert.deepEqual(event.filled,[]);for(const broken of event.brokenCards){assert(!seen.has(broken.index));seen.add(broken.index);assert.equal(broken.card,base.board[broken.index]);}}
    if(s.status==='settling'){assert.equal(s.chain.spawned,s.chain.destroyed);assert(s.board.every(Boolean));E.complete(s);}
  }
});
