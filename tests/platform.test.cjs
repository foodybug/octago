const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {apiUrl}=require('../platform.js');

test('HTTP devices without randomUUID still create unique server-compatible run IDs and save keys',()=>{
  const context=vm.createContext({crypto:{getRandomValues:bytes=>crypto.webcrypto.getRandomValues(bytes)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../platform.js'),'utf8'),context);
  const ids=Array.from({length:100},()=>context.OctagoPlatform.newId());
  assert.equal(new Set(ids).size,ids.length);
  assert(ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
});

test('all platforms address one configured API while same-server clients keep relative URLs',()=>{
  assert.equal(apiUrl('/api/scores',''),'/api/scores');
  assert.equal(apiUrl('/api/leaderboard','https://rank.example.com/'),'https://rank.example.com/api/leaderboard');
  assert.equal(apiUrl('/api/scores','https://example.com/octago///'),'https://example.com/octago/api/scores');
  for(const base of ['javascript:alert(1)','file:///game','https://name:secret@example.com','https://example.com/?key=x','https://example.com/#hash'])assert.throws(()=>apiUrl('/api/scores',base));
});
