import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import Fastify from 'fastify';
import {buildMediaUploadRouter,storeUploadedImage} from '../media-upload';
import {errorHandler} from '../../../shared/middleware/error.middleware';
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const fixture=()=>readFile(new URL('./fixtures/cutout.webp',import.meta.url));
describe('owned media upload',()=>{
 it('requires the integration bearer token before handling image bytes',async()=>{
  const app=Fastify();app.setErrorHandler(errorHandler);await app.register(buildMediaUploadRouter({} as any,{adminToken:'test-secret',mediaRoot:'/unused'}));
  expect((await app.inject({method:'POST',url:'/admin/integration/media',headers:{'content-type':'image/webp'},payload:await fixture()})).statusCode).toBe(401);
  await app.close();
 });
 it('rejects bytes that disagree with their declared media type',async()=>{
  const root=await mkdtemp(join(tmpdir(),'florelle-upload-'));directories.push(root);
  await expect(storeUploadedImage(Buffer.from('<svg/>'),'image/png',root)).rejects.toThrow(/image/i);
  await expect(storeUploadedImage(await fixture(),'image/jpeg',root)).rejects.toThrow(/type/i);
 });
 it('preserves original bytes, creates real bounded variants and derives transparent framing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'florelle-upload-'));directories.push(root);const original=await fixture();
  const result=await storeUploadedImage(original,'image/webp',root);
  expect(result.photo.url).toContain(createHash('sha256').update(original).digest('hex'));
  expect(await readFile(join(root,result.photo.url.split('/').at(-1)!))).toEqual(original);
  expect(result.photo.variants.length).toBeGreaterThan(0);expect(result.photo.variants.every(v=>v.width<=1800&&v.height<=1800)).toBe(true);
  expect(result.photo.framing?.width).toBe(396);expect(result.files.every(f=>f.bytes>0)).toBe(true);
 });
});
