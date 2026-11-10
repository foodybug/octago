const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const files=['Dockerfile','.dockerignore','railway.json','package.json','server.cjs','leaderboard.cjs','engine.js','platform.js','index.html','style.css','app.js','lobby.js','config.js'];
async function pack(){
  const directory=path.join(root,'artifacts','railway-'+crypto.randomUUID());
  await fs.mkdir(directory,{recursive:true});
  const checksums={};
  for(const name of files){const data=await fs.readFile(path.join(root,name));await fs.writeFile(path.join(directory,name),data);checksums[name]=crypto.createHash('sha256').update(data).digest('hex');}
  const manifest={directory,files:checksums};
  await fs.writeFile(path.join(root,'artifacts','railway-package.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
}
pack().catch(error=>{console.error(error.message);process.exitCode=1;});
