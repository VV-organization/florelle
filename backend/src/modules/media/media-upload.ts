import type {FastifyPluginAsync} from 'fastify';
import sharp, {type Metadata} from 'sharp';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Database} from '../../shared/db/client';
import {mediaAssets,type MediaPhoto} from '../../shared/db/schema/storefront';
import {authorizeIntegrationRequest} from '../integration/integration.auth';
import {ValidationError} from '../../shared/middleware/error.middleware';
const MAX_BYTES=10*1024*1024;
const types:Record<string,string>={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
export async function storeUploadedImage(bytes:Buffer,contentType:string,mediaRoot:string){
 if(!types[contentType]||bytes.length===0||bytes.length>MAX_BYTES)throw new ValidationError('Invalid image type or size (maximum 10 MB)');
 let metadata:Metadata;
 try{metadata=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'}).metadata();}catch{throw new ValidationError('Invalid image data');}
 if(metadata.format!==types[contentType])throw new ValidationError('Image content does not match declared media type');
 if(!metadata.width||!metadata.height||(metadata.pages??1)>1)throw new ValidationError('Only a single image is supported');
 const files:Array<{sourcePath:string;checksum:string;filename:string;bytes:number;contentType:string;metadata:MediaPhoto}>=[];
 const buffers:Array<{filename:string;data:Buffer}>=[];
 function asset(data:Buffer,ext:string,mime:string){
  const checksum=createHash('sha256').update(data).digest('hex');const filename=`${checksum}.${ext}`;const url=`/media/${filename}`;
  files.push({sourcePath:`/uploads/${filename}`,checksum,filename,bytes:data.length,contentType:mime,metadata:{url,variants:[]}});buffers.push({filename,data});return url;
 }
 const url=asset(bytes,metadata.format==='jpeg'?'jpg':metadata.format,contentType);const variants:MediaPhoto['variants']=[];
 const edges=[...new Set([640,1024,1800].map(edge=>Math.min(edge,Math.max(metadata.width!,metadata.height!))))];
 try{
  for(const edge of edges){const result=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'}).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer({resolveWithObject:true});variants.push({src:asset(result.data,'webp','image/webp'),width:result.info.width,height:result.info.height});}
 }catch{throw new ValidationError('Invalid image pixels');}
 const photo:MediaPhoto={url,variants};
 if(metadata.hasAlpha){
  const raw=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=raw.info;let last=-1;
  for(let y=height-1;y>=0&&last<0;y--)for(let x=0;x<width;x++)if(raw.data[(y*width+x)*channels+channels-1]!>8){last=y;break;}
  photo.framing={bottom:Math.round((height-last-1)/height*10000)/100,width,height};
 }
 files[0]!.metadata=photo;
 await mkdir(mediaRoot,{recursive:true});
 for(const file of buffers)await writeFile(join(mediaRoot,file.filename),file.data);
 return {photo,files};
}
export function buildMediaUploadRouter(db:Database,options:{adminToken?:string;mediaRoot?:string}):FastifyPluginAsync{
 return async(app)=>{
  app.addContentTypeParser(['image/jpeg','image/png','image/webp'],{parseAs:'buffer',bodyLimit:MAX_BYTES},(_request,body,done)=>done(null,body));
  app.post('/admin/integration/media',{
   bodyLimit:MAX_BYTES,
   onRequest:async(request)=>{authorizeIntegrationRequest(request.headers.authorization,options.adminToken);},
  },async(request,reply)=>{
   if(!Buffer.isBuffer(request.body))throw new ValidationError('Raw image body is required');
   const result=await storeUploadedImage(request.body,request.headers['content-type']?.split(';')[0]??'',resolve(options.mediaRoot??process.env.MEDIA_ROOT??'.runtime/media'));
   await db.transaction(async tx=>{for(const file of result.files)await tx.insert(mediaAssets).values(file).onConflictDoNothing();});
   return reply.code(201).send(result.photo);
  });
 };
}
