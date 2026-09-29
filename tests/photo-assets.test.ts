import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
const read=(path:string)=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const catalog=read('../src/data/catalog.json');
const photos=read('../src/data/image-quality.json');
test('every catalog offer has responsive restored photographs',()=>{
 for(const item of catalog.items){
  const source=item.image==='/catalog/cutouts/1018.webp'?'/catalog/cutouts/27132.webp':item.image;
  const photo=photos[source];assert.ok(photo,source);
  assert.ok(photo.variants.length>=3,source);
  assert.ok(photo.variants.at(-1).edge>=1200,source);
 }
});
test('all declared variants exist and agree with their recorded sizes',()=>{
 for(const [source,photo] of Object.entries(photos) as [string,{variants:{src:string;width:number;height:number;bytes:number}[]}][]){
  let previous=0;
  for(const variant of photo.variants){
   assert.ok(variant.width>previous,source);previous=variant.width;
   assert.ok(variant.height>0,source);
   assert.equal(statSync(new URL('../public'+variant.src,import.meta.url)).size,variant.bytes,variant.src);
  }
 }
 for(const name of ['botanical-green','botanical-bloom','source-flowers'])assert.equal(photos['/images/'+name+'.jpg'].variants.at(-1).edge,3072);
});
