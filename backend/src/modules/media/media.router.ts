import type { FastifyPluginAsync } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export function buildMediaRouter(mediaRoot=resolve(process.env.MEDIA_ROOT??'.runtime/media')):FastifyPluginAsync {
 return async(app)=>{
  app.get<{Params:{filename:string}}>('/media/:filename',async(request,reply)=>{
   const {filename}=request.params;
   if(!/^[a-f0-9]{64}\.(jpg|jpeg|png|webp|gif|svg|avif)$/.test(filename))return reply.code(404).send({error:'Media not found'});
   const path=join(mediaRoot,filename); const info=await stat(path).catch(()=>null);
   if(!info?.isFile())return reply.code(404).send({error:'Media not found'});
   const etag='"'+filename.split('.')[0]+'"';
   reply.header('ETag',etag).header('Cache-Control','public, max-age=31536000, immutable').header('X-Content-Type-Options','nosniff');
   if(request.headers['if-none-match']===etag)return reply.code(304).send();
   const contentTypes:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',avif:'image/avif'};
   return reply.type(contentTypes[filename.split('.').at(-1)!]!).header('Content-Length',info.size).send(createReadStream(path));
  });
 };
}
