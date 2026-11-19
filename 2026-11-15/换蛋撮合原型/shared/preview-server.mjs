import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const app='2026-11-15/换蛋撮合原型';
const allowed=[app+'/editor/',app+'/outputs/',app+'/shared/','docs/prototypes/shared/'];
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const server=http.createServer((req,res)=>{
 let url;try{url=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)}catch{res.writeHead(400);res.end();return}
 if(!url){res.writeHead(302,{Location:'/'+encodeURI(app+'/editor/index.html')});res.end();return}
 const full=path.resolve(repo,url);
 if(!full.startsWith(repo+path.sep)||!allowed.some(p=>url.startsWith(p))||!types[path.extname(full)]||!fs.existsSync(full)||!fs.statSync(full).isFile()){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':types[path.extname(full)],'Cache-Control':'no-store'});fs.createReadStream(full).pipe(res);
});
server.listen(4187,'127.0.0.1',()=>console.log('本机预览 http://127.0.0.1:4187/ （仅监听本机，不是部署）'));
