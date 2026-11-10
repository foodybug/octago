(() => {
  'use strict';
  const $=id=>document.getElementById(id),number=n=>n.toLocaleString('en-US');
  let handlers={},lastResultKey=null,currentSnapshot=null,listVersion=0;
  try{$('player-name').value=localStorage.getItem('octago-player-name')||'';}catch{}
  function playerName(){const name=$('player-name').value.trim()||'플레이어';try{localStorage.setItem('octago-player-name',name);}catch{}return name;}
  async function request(url,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{const response=await fetch(OctagoPlatform.apiUrl(url),{...options,credentials:'omit',signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'서버에 연결하지 못했습니다.');return data;}
    finally{clearTimeout(timer);}
  }
  function renderTable(id,entries,ownId){
    const body=$(id);body.replaceChildren();
    if(!entries.length){const row=body.insertRow(),cell=row.insertCell();cell.colSpan=4;cell.className='ranking-empty';cell.textContent='아직 기록이 없어요. 첫 번째 기록을 남겨보세요.';return;}
    for(const entry of entries){
      const row=body.insertRow();if(entry.id===ownId)row.className='my-record';
      for(const [index,value] of [String(entry.rank).padStart(2,'0'),entry.name,number(entry.score),'STAGE '+String(entry.stage).padStart(2,'0')].entries()){
        const cell=row.insertCell();cell.textContent=value;if(index===0)cell.className='rank-number';if(index===2)cell.className='rank-score';
      }
    }
  }
  function renderRankings(data,ownId){
    renderTable('title-leaderboard',data.entries,ownId);renderTable('result-leaderboard',data.entries,ownId);
    $('ranking-total').textContent=number(data.total)+'개의 기록';$('result-total').textContent='전체 '+number(data.total)+'개 기록';$('server-status').textContent='서버 연결됨';$('server-status').dataset.status='connected';
  }
  async function loadLeaderboard(){
    const version=++listVersion;$('server-status').textContent='랭킹 불러오는 중';$('server-status').dataset.status='loading';$('leaderboard-refresh').disabled=true;
    try{const data=await request('/api/leaderboard');if(version===listVersion)renderRankings(data);}
    catch{if(version===listVersion){$('server-status').textContent='서버 연결 대기';$('server-status').dataset.status='offline';const body=$('title-leaderboard');body.replaceChildren();const cell=body.insertRow().insertCell();cell.colSpan=4;cell.className='ranking-empty';cell.textContent='랭킹을 불러오지 못했어요. 새로고침을 눌러 주세요.';}}
    finally{$('leaderboard-refresh').disabled=false;}
  }
  function showReceipt(receipt){
    $('result-rank').textContent=number(receipt.record.rank)+'위';$('result-rank-detail').textContent='전체 '+number(receipt.total)+'개 기록 중';
    $('result-status').textContent='서버에 점수와 스테이지를 저장했어요.';$('result-status').dataset.status='saved';$('result-retry').hidden=true;
  }
  async function saveResult(snapshot){
    if(snapshot.inFlight)return;snapshot.inFlight=true;$('result-retry').hidden=true;$('result-status').dataset.status='saving';$('result-status').textContent='서버에 기록 저장 중…';
    try{
      const receipt=await request('/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot.payload)});
      ++listVersion;renderRankings(receipt,receipt.record.id);if(snapshot.key===lastResultKey)showReceipt(receipt);
    }catch(error){if(snapshot.key===lastResultKey){$('result-status').textContent=error.name==='AbortError'?'서버 응답이 늦어지고 있어요. 다시 저장해 주세요.':error.message;$('result-status').dataset.status='error';$('result-rank-detail').textContent='아직 저장되지 않은 기록';$('result-retry').hidden=false;}}
    finally{snapshot.inFlight=false;}
  }
  function hideResult(){if($('result-dialog').open)$('result-dialog').close();$('gameover-overlay').hidden=true;}
  function showResult(state,run){
    const key=run.id+':'+run.revision;
    $('gameover-score').textContent=number(state.score);$('result-stage').textContent=String(Math.max(1,state.moves)).padStart(2,'0');$('result-player').textContent=run.name;$('result-destroyed').textContent=number(state.destroyed);$('result-chain').textContent=state.bestChain;
    $('gameover-overlay').hidden=false;if(!$('result-dialog').open)$('result-dialog').showModal();
    if(key!==lastResultKey){
      lastResultKey=key;$('result-rank').textContent='—';$('result-rank-detail').textContent='기록을 확인하고 있어요.';
      currentSnapshot={key,payload:{runId:run.id,token:run.token,revision:run.revision,name:run.name,seed:state.seed,actions:run.actions.map(action=>({...action}))}};
      saveResult(currentSnapshot);
    }
  }
  function showTitle(canResume){hideResult();$('title-screen').hidden=false;$('game-screen').hidden=true;$('title-home').hidden=true;$('title-continue').hidden=!canResume;window.scrollTo(0,0);loadLeaderboard();}
  function showGame(){$('title-screen').hidden=true;$('game-screen').hidden=false;$('title-home').hidden=false;hideResult();window.scrollTo(0,0);}
  function personal(score,stage){$('personal-score').textContent=number(score);$('personal-stage').textContent=stage?'STAGE '+String(stage).padStart(2,'0'):'—';}
  function bind(callbacks){
    handlers=callbacks;$('title-start').onclick=()=>handlers.start();$('title-continue').onclick=()=>handlers.resume();$('title-home').onclick=()=>handlers.home();$('result-home').onclick=()=>handlers.home();
    document.querySelector('.brand').onclick=event=>{event.preventDefault();handlers.home();};$('leaderboard-refresh').onclick=loadLeaderboard;$('result-retry').onclick=()=>currentSnapshot&&saveResult(currentSnapshot);
    $('result-dialog').addEventListener('cancel',event=>{event.preventDefault();handlers.home();});$('player-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();handlers.start();}});
  }
  window.OctagoLobby={bind,playerName,showTitle,showGame,showResult,hideResult,personal};
})();
