const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const E=require('./engine.js');
class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const better=(a,b)=>a.score>b.score||a.score===b.score&&a.stage>b.stage;
const compare=(a,b)=>b.score-a.score||b.stage-a.stage||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
const publicRecord=({id,name,seed,score,stage,destroyed,bestChain,createdAt,updatedAt})=>({id,name,seed,score,stage,destroyed,bestChain,createdAt,updatedAt});
function verifyRun(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'올바른 기록을 보내 주세요.');
  const {runId,token,revision,seed,actions}=body,name=typeof body.name==='string'?body.name.trim():'';
  if(typeof runId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId))throw new ApiError(400,'게임 식별자가 올바르지 않습니다.');
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw new ApiError(400,'게임 저장 키가 올바르지 않습니다.');
  if(!Number.isSafeInteger(revision)||revision<1||revision>100000)throw new ApiError(400,'기록 버전이 올바르지 않습니다.');
  if(!name||Array.from(name).length>16||/[\u0000-\u001f\u007f]/.test(name))throw new ApiError(400,'이름은 1~16자로 입력해 주세요.');
  if(typeof seed!=='string'||!seed.length||seed.length>48)throw new ApiError(400,'필드 시드가 올바르지 않습니다.');
  if(!Array.isArray(actions)||!actions.length||actions.length>2000)throw new ApiError(400,'플레이 내역이 올바르지 않습니다.');
  let state=E.create(seed),phases=0;
  try{
    for(const action of actions){
      if(!action||!Number.isInteger(action.index)||action.index<0||action.index>=64)throw Error('Invalid action');
      if(action.type==='equip')state=E.equip(state,action.slot,action.index);
      else if(action.type==='activate'){
        state=E.begin(state,action.index);
        while(state.status==='running'){if(++phases>20000)throw Error('Replay limit exceeded');state=E.step(state);}
        state=E.complete(state);
      }else throw Error('Invalid action');
    }
  }catch{throw new ApiError(400,'플레이 내역을 확인할 수 없습니다.');}
  if(state.status!=='gameover')throw new ApiError(400,'종료된 게임만 기록할 수 있습니다.');
  if(!Number.isSafeInteger(state.score))throw new ApiError(400,'점수 범위를 초과했습니다.');
  return {id:runId,tokenHash:hash(token),revision,name,seed,score:state.score,stage:state.moves,destroyed:state.destroyed,bestChain:state.bestChain};
}
class Leaderboard {
  constructor(file,records){this.file=file;this.records=records;this.pending=Promise.resolve();}
  static async open(file){
    let records=[];
    try{const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version!==1||!Array.isArray(data.records)||data.records.some(r=>!r.id||!r.tokenHash||!Number.isSafeInteger(r.score)||r.score<0||!Number.isSafeInteger(r.stage)||r.stage<1))throw Error('Invalid leaderboard file');records=data.records;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    return new Leaderboard(file,records);
  }
  table(limit=10){const sorted=this.records.slice().sort(compare);return {total:sorted.length,entries:sorted.slice(0,limit).map(record=>({...publicRecord(record),rank:sorted.filter(other=>better(other,record)).length+1}))};}
  receipt(id){const record=this.records.find(record=>record.id===id);return {...this.table(),record:{...publicRecord(record),rank:this.records.filter(other=>better(other,record)).length+1}};}
  save(record){
    const task=async()=>{
      const old=this.records.find(other=>other.id===record.id);
      if(old&&old.tokenHash!==record.tokenHash)throw new ApiError(403,'다른 게임의 기록을 변경할 수 없습니다.');
      if(old&&old.seed!==record.seed)throw new ApiError(409,'게임 시드가 일치하지 않습니다.');
      if(old&&record.revision<=old.revision)return this.receipt(old.id);
      const now=new Date().toISOString(),next={...record,createdAt:old?.createdAt||now,updatedAt:now},records=this.records.filter(other=>other.id!==record.id).concat(next);
      await fs.mkdir(path.dirname(this.file),{recursive:true});const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,JSON.stringify({version:1,records},null,2),'utf8');await fs.rename(temporary,this.file);}
      catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
      this.records=records;return this.receipt(record.id);
    };
    const result=this.pending.then(task,task);this.pending=result.catch(()=>{});return result;
  }
}
module.exports={Leaderboard,verifyRun,ApiError};
