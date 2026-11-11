/* Only the public dist directory is served. No originals, backups or credentials. */
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const ROOT=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(ROOT,'kitchen.config.json'),'utf8'));
function createServer(directory=path.join(ROOT,config.output)) {
  const base=config.previewBase;
  return http.createServer((req,res)=>{
    const fail=status=>{res.writeHead(status);res.end();};
    if(!['GET','HEAD'].includes(req.method)) return fail(405);
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      if(!pathname.startsWith(base)) return fail(404);
      const rel=pathname.slice(base.length)||'index.html';
      if(rel.split(/[\\/]/).some(p=>p.startsWith('.'))||rel.includes('\0')) return fail(403);
      const target=path.resolve(directory,rel);
      if(!target.startsWith(path.resolve(directory)+path.sep)) return fail(403);
      const stat=fs.lstatSync(target);
      if(!stat.isFile()||stat.isSymbolicLink()) return fail(404);
      const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.json':'application/json; charset=utf-8'};
      res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      if(req.method==='HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    } catch(e){fail(e.code==='ENOENT'?404:500);}
  });
}
if(require.main===module){
  const server=createServer();
  server.listen(config.previewPort,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${config.previewPort}${config.previewBase}`));
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={createServer,ROOT,config};
