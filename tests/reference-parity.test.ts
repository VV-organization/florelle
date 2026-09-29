import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('../src/data/catalog.json',import.meta.url),'utf8'));
const delivery=JSON.parse(readFileSync(new URL('../src/data/delivery.json',import.meta.url),'utf8'));

test('curated collections select exact source offers, not all sellers of each product',()=>{
 const expected={'best-sellers':20,'premium-roses':20,'spring-collection':15};
 for(const collection of catalog.collections){
  const ids=new Set(collection.listingIds);
  assert.equal(ids.size,expected[collection.slug as keyof typeof expected]);
  const found=catalog.items.filter((item:{id:string})=>ids.has(item.id));
  assert.equal(found.length,ids.size);
 }
});
test('catalogue cutouts and all 37 delivery destinations are present',()=>{
 for(const item of catalog.items)assert.ok(existsSync(new URL('../public'+item.image,import.meta.url)),item.image);
 assert.deepEqual(delivery.map((c:{code:string;cities:unknown[]})=>[c.code,c.cities.length]),[['RU',12],['KZ',12],['TR',13]]);
 const moscow=delivery[0].cities.find((c:{value:string})=>c.value==='Moscow');
 assert.equal(Math.max(moscow.minimums[2],moscow.rates[2]*100),3800);
});
