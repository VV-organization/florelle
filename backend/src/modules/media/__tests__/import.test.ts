import { describe, it, expect } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareImport, scanMedia } from '../import';

describe('Florelle import', () => {
 it('preserves every source listing ID, exact RUB price and stock in stems', async () => {
  const source = JSON.parse(await readFile('import-data/catalog.json','utf8'));
  const plan = prepareImport(source, {});
  expect(plan.products).toHaveLength(511);
  expect(plan.categories).toHaveLength(31);
  expect(plan.products.every(product=>typeof product.color==='string')).toBe(true);
  expect(plan.listings).toHaveLength(1000);
  for (const [i,row] of plan.listings.entries()) {
   expect(row.id).toBe(source.items[i].id);
   expect(row.retailPrice).toBe(source.items[i].seller_price);
   expect(row.wholesalePrice).toBe(source.items[i].wholesale.seller_price);
   expect(row.referencePrice).toBe(source.items[i].wholesale.ams_price);
   expect(row.availableStems).toBe(source.items[i].available_units);
  }
  expect(plan.collections.map(c=>c.id)).toEqual(source.collections.map((c:any)=>c.id));
  expect(plan.collectionItems).toHaveLength(55);
  expect(plan.featuredListingIds.slice(0,4)).toEqual([0,1,2,13].map(i=>source.items[i].id));
  expect(plan.featuredListingIds).toHaveLength(8);
 });
 it('rejects duplicate listing IDs before any write', async () => {
  const source = JSON.parse(await readFile('import-data/catalog.json','utf8'));
  source.items.push(source.items[0]);
  expect(()=>prepareImport(source,{})).toThrow(/duplicate listing/i);
 });
 it('addresses preserved bytes by checksum, resolves variants/aliases and performs a read-only dry run', async () => {
  const root=await mkdtemp(join(tmpdir(),'florelle-media-')); const publicDir=join(root,'public'); const mediaRoot=join(root,'media');
  await mkdir(join(publicDir,'catalog'),{recursive:true});
  const bytes=Buffer.from('89504e470d0a1a0a0000000d494844520000000100000002','hex');
  await writeFile(join(publicDir,'catalog/a.png'),bytes);
  const quality={'/catalog/a.png':{original:[1,2],variants:[{src:'/catalog/a.png',width:1,height:2}]}};
  const result=await scanMedia(publicDir,mediaRoot,quality,{'/catalog/a.png':{bottom:4,width:1,height:2}},false,{'/old.png':'/catalog/a.png'});
  expect(result.files).toHaveLength(1); expect(result.media['/old.png']).toEqual(result.media['/catalog/a.png']);
  expect(result.media['/catalog/a.png']?.url).toMatch(/^\/media\/[a-f0-9]{64}\.png$/);
  expect(await readdir(root)).toEqual(['public']);
  await scanMedia(publicDir,mediaRoot,quality,{},true,{});
  expect(await readFile(join(mediaRoot,result.files[0]!.filename))).toEqual(bytes);
  await rm(root,{recursive:true,force:true});
 });
});
