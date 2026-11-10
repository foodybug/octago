const path=require('node:path');
const {createServer}=require('../../server.cjs');
module.exports=async()=>{
  const server=await createServer({dataFile:path.join(__dirname,'../../artifacts/leaderboard-ui-'+Date.now()+'.json')});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3137,'127.0.0.1',resolve);});
  return async()=>{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));};
};
