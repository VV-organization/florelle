import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
const root=resolve('out');
const prefix='/florelle';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.txt':'text/plain'};
const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname===prefix){response.writeHead(308,{Location:prefix+'/'+url.search});response.end();return;}
  let path;
  try {path=resolve(root,'.'+decodeURIComponent(url.pathname.slice(prefix.length)));} catch {response.writeHead(400);response.end();return;}
  if(!url.pathname.startsWith(prefix+'/') || (path!==root&&!path.startsWith(root+sep))){response.writeHead(404);response.end();return;}
  if(existsSync(path)&&statSync(path).isDirectory()){
    if(!url.pathname.endsWith('/')){response.writeHead(308,{Location:url.pathname+'/'+url.search});response.end();return;}
    path=resolve(path,'index.html');
  }
  if(!existsSync(path)){response.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});createReadStream(resolve(root,'404.html')).pipe(response);return;}
  response.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});
  createReadStream(path).pipe(response);
});
server.listen(Number(process.env.PORT||5196),'127.0.0.1',()=>console.log(`Pages preview: http://127.0.0.1:${server.address().port}${prefix}/`));
