const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {createServer}=require('../server.cjs');
const {verifyRun}=require('../leaderboard.cjs');
const E=require('../engine.js');
function completed(seed='server-rules',opening){
  let s=E.create(seed);const actions=[];
  while(s.status!=='gameover'){
    const index=actions.length===0&&opening!==undefined?opening:s.board.findIndex((card,i)=>!E.isSpecial(card)&&E.connections(s,i).length===0);
    assert(index>=0);actions.push({type:'activate',index});s=E.begin(s,index);while(s.status==='running'&&s.phase<500)s=E.step(s);assert.equal(s.status,'settling');s=E.complete(s);assert(actions.length<30);
  }
  return {state:s,body:{runId:crypto.randomUUID(),token:crypto.randomUUID(),revision:1,name:'테스트 플레이어',seed,actions}};
}
async function setup(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'octago-server-')),file=path.join(directory,'scores.json'),servers=[];
  async function start(options={}){const server=await createServer({...options,dataFile:file});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);return {server,url:'http://127.0.0.1:'+server.address().port};}
  t.after(async()=>{for(const server of servers)if(server.listening)await new Promise(resolve=>server.close(resolve));if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('octago-server-'))throw Error('Unexpected temporary path');await fs.rm(directory,{recursive:true,force:true});});
  return {file,start};
}
async function post(url,body){const response=await fetch(url+'/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}

test('the server recomputes score and stage, persists them across restarts, and keeps private data private',async t=>{
  const {file,start}=await setup(t),first=await start(),game=completed();
  const saved=await post(first.url,{...game.body,score:999999999,stage:999});assert.equal(saved.status,200);assert.equal(saved.data.record.score,game.state.score);assert.equal(saved.data.record.stage,game.state.moves);assert.equal(saved.data.record.rank,1);assert.equal(saved.data.total,1);assert(!JSON.stringify(saved.data).includes(game.body.token));assert(!JSON.stringify(saved.data).includes('tokenHash'));
  const disk=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(disk.records.length,1);assert.equal(disk.records[0].score,game.state.score);
  await new Promise(resolve=>first.server.close(resolve));const second=await start(),loaded=await fetch(second.url+'/api/leaderboard').then(r=>r.json());assert.equal(loaded.entries[0].id,game.body.runId);assert.equal(loaded.entries[0].stage,game.state.moves);
  for(const name of ['/data/leaderboard.json','/leaderboard.cjs','/server.cjs','/package.json','/tests/server.test.cjs'])assert.equal((await fetch(second.url+name)).status,404);
});

test('concurrent submissions preserve every run, ties share a rank, and duplicate retries do not add rows',async t=>{
  const {start}=await setup(t),{url}=await start(),game=completed('same-run');
  const bodies=Array.from({length:6},(_,i)=>({...game.body,runId:crypto.randomUUID(),token:crypto.randomUUID(),name:'플레이어 '+i}));
  const results=await Promise.all(bodies.map(body=>post(url,body)));assert(results.every(r=>r.status===200));const board=await fetch(url+'/api/leaderboard').then(r=>r.json());assert.equal(board.total,6);assert(board.entries.every(row=>row.rank===1));
  await post(url,bodies[0]);assert.equal((await fetch(url+'/api/leaderboard').then(r=>r.json())).total,6);
  const updated=await post(url,{...bodies[0],revision:2,name:'새 이름'});assert.equal(updated.data.record.name,'새 이름');await post(url,bodies[0]);assert.equal((await fetch(url+'/api/leaderboard').then(r=>r.json())).entries.find(row=>row.id===bodies[0].runId).name,'새 이름');
  assert.equal((await post(url,{...bodies[0],token:crypto.randomUUID(),revision:3})).status,403);
});

test('invalid or unfinished gameplay is rejected and raw client scores are never trusted',async t=>{
  const {start}=await setup(t),{url}=await start(),game=completed(),initial=E.create(game.body.seed),special=initial.board.findIndex(E.isSpecial);
  for(const body of [{...game.body,actions:[]},{...game.body,actions:game.body.actions.slice(0,1)},{...game.body,actions:[{type:'activate',index:special}]},{...game.body,actions:[{type:'equip',slot:0,index:0}]},{...game.body,name:'x'.repeat(17)},{...game.body,token:'bad'}])assert.equal((await post(url,body)).status,400);
  assert.equal((await fetch(url+'/api/scores',{method:'POST',body:'hello'})).status,415);
  assert.equal((await fetch(url+'/api/leaderboard?limit=-1')).status,400);
  assert.equal((await fetch(url+'/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"broken":'})).status,400);
  assert.equal((await fetch(url+'/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(140000)})})).status,413);
  assert.equal((await fetch(url+'/api/leaderboard').then(r=>r.json())).total,0);
});

test('leaderboards sort by score first and then reached stage',async t=>{
  const {start}=await setup(t),{url}=await start(),a=completed('octago-001'),b=completed('octago-001',60);
  await post(url,a.body);await post(url,b.body);const result=await fetch(url+'/api/leaderboard').then(r=>r.json());assert.equal(result.total,2);
  const expected=[verifyRun(a.body),verifyRun(b.body)].sort((a,b)=>b.score-a.score||b.stage-a.stage);assert.deepEqual(result.entries.map(row=>[row.score,row.stage]),expected.map(row=>[row.score,row.stage]));
});

test('server verification reproduces item acquisition, placement and activation',()=>{
  let state=E.create('stage-item-7');const actions=[];
  function activate(index){actions.push({type:'activate',index});state=E.begin(state,index);while(state.status==='running'&&state.phase<500)state=E.step(state);state=E.complete(state);}
  activate(45);assert.equal(state.inventory[0],'row');const index=state.board.findIndex(card=>!E.isSpecial(card));actions.push({type:'equip',slot:0,index});state=E.equip(state,0,index);activate(index);
  while(state.status!=='gameover'){const quiet=state.board.findIndex((card,i)=>!E.isSpecial(card)&&E.connections(state,i).length===0);assert(quiet>=0);activate(quiet);assert(actions.length<30);}
  const verified=verifyRun({runId:crypto.randomUUID(),token:crypto.randomUUID(),revision:1,name:'아이템 기록',seed:'stage-item-7',actions});assert.equal(verified.score,state.score);assert.equal(verified.stage,state.moves);assert.equal(verified.destroyed,state.destroyed);
});

test('separate web and app origins share rankings through allowed CORS preflights and requests',async t=>{
  const {start}=await setup(t),web='https://play.example.com',mobile='capacitor://localhost',{url}=await start({allowedOrigins:[web,mobile]}),game=completed('cross-platform');
  for(const origin of [web,mobile]){
    const preflight=await fetch(url+'/api/scores',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.match(preflight.headers.get('access-control-allow-methods'),/POST/);assert.match(preflight.headers.get('access-control-allow-headers'),/Content-Type/i);
  }
  const saved=await fetch(url+'/api/scores',{method:'POST',headers:{Origin:web,'Content-Type':'application/json'},body:JSON.stringify(game.body)});assert.equal(saved.status,200);assert.equal(saved.headers.get('access-control-allow-origin'),web);
  const read=await fetch(url+'/api/leaderboard',{headers:{Origin:mobile}});assert.equal(read.headers.get('access-control-allow-origin'),mobile);assert.equal((await read.json()).entries[0].id,game.body.runId);
  for(const method of ['GET','OPTIONS']){
    const denied=await fetch(url+'/api/leaderboard',{method,headers:{Origin:'https://unlisted.example.com'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  }
  assert.equal((await fetch(url+'/api/leaderboard',{headers:{Origin:url}})).status,200);
});

test('a deployed client receives its common API URL without receiving server-only settings',async t=>{
  const {start}=await setup(t),apiBaseUrl='https://rank.example.com',{url}=await start({apiBaseUrl,allowedOrigins:['capacitor://localhost']});
  const response=await fetch(url+'/config.js'),body=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(body,/OCTAGO_CONFIG/);assert(body.includes(JSON.stringify(apiBaseUrl)));assert(!body.includes('capacitor'));assert(!body.includes('leaderboard.json'));
  assert.equal((await fetch(url+'/platform.js')).status,200);
  await assert.rejects(()=>start({apiBaseUrl:'file:///private'}));
});
