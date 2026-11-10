const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {Leaderboard,verifyRun,ApiError}=require('./leaderboard.cjs');
const {apiUrl}=require('./platform.js');
const root=__dirname;
const publicFiles=new Set(['index.html','style.css','engine.js','app.js','lobby.js','config.js','platform.js']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function readJson(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new ApiError(415,'JSON 형식으로 보내 주세요.');
  return new Promise((resolve,reject)=>{
    let bytes=0,tooLarge=false;const chunks=[];
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>131072){tooLarge=true;return;}if(!tooLarge)chunks.push(chunk);});
    req.on('end',()=>{if(tooLarge)return reject(new ApiError(413,'플레이 내역이 너무 큽니다.'));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new ApiError(400,'JSON 형식이 올바르지 않습니다.'));}});req.on('error',reject);
  });
}
async function createServer(options={}){
  const file=options.dataFile||process.env.LEADERBOARD_FILE||path.join(root,'data','leaderboard.json'),store=await Leaderboard.open(path.resolve(file));
  const apiBaseUrl=options.apiBaseUrl??process.env.RANKING_API_URL;
  if(apiBaseUrl!==undefined)apiUrl('',apiBaseUrl);
  const allowedOrigins=new Set(options.allowedOrigins??(process.env.CORS_ORIGINS||'').split(',').map(origin=>origin.trim()).filter(Boolean));
  return http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){
        res.setHeader('Vary','Origin');
        const origin=req.headers.origin;
        const sameOrigin=origin&&/^https?:\/\//.test(origin)&&new URL(origin).host===req.headers.host;
        if(origin&&!sameOrigin&&!allowedOrigins.has(origin)&&!allowedOrigins.has('*'))throw new ApiError(403,'허용되지 않은 게임 서버 주소입니다.');
        if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
        if(req.method==='OPTIONS'){
          res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}).end();return;
        }
      }
      if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,storage:'file',ranking:'score-desc-stage-desc'});
      if(url.pathname==='/api/leaderboard'&&req.method==='GET'){
        const limit=Number(url.searchParams.get('limit')||10);if(!Number.isInteger(limit)||limit<1||limit>50)throw new ApiError(400,'조회 개수는 1~50 사이여야 합니다.');return json(res,200,store.table(limit));
      }
      if(url.pathname==='/api/scores'&&req.method==='POST')return json(res,200,await store.save(verifyRun(await readJson(req))));
      if(url.pathname.startsWith('/api/'))throw new ApiError(404,'요청한 API가 없습니다.');
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
      const name=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1));
      if(!publicFiles.has(name)){res.writeHead(404).end('Not found');return;}
      const content=name==='config.js'&&apiBaseUrl!==undefined?'globalThis.OCTAGO_CONFIG=Object.freeze('+JSON.stringify({apiBaseUrl})+');':await fs.readFile(path.join(root,name));res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:content);
    }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'기록을 저장하지 못했습니다. 다시 시도해 주세요.'});else res.end();}
  });
}
if(require.main===module)createServer().then(server=>{
  const host=process.env.HOST||'0.0.0.0';
  server.listen(Number(process.env.PORT??3000),host,()=>{
    const port=server.address().port;console.log('OCTAGO http://localhost:'+port);
    if(['0.0.0.0','::'].includes(host))for(const address of new Set(Object.values(os.networkInterfaces()).flat().filter(address=>address.family==='IPv4'&&!address.internal).map(address=>address.address)))console.log('Network http://'+address+':'+port);
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}).catch(error=>{console.error('OCTAGO server:',error.message);process.exitCode=1;});
module.exports={createServer};
