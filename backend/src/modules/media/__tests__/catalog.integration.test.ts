import {parse} from 'dotenv';
import {readFileSync} from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {eq} from 'drizzle-orm';
import {listings} from '../../../shared/db/schema/listings';
import {products} from '../../../shared/db/schema/products';
import {storefrontSettings} from '../../../shared/db/schema/storefront';
import { drizzle } from 'drizzle-orm/postgres-js';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import type { Database } from '../../../shared/db/client';
import type { FxService } from '../../../shared/currency/fx.service';
import { CatalogService } from '../../catalog/catalog.service';
import { productsQuerySchema } from '../../catalog/catalog.schema';
import { buildStorefrontRouter } from '../../storefront/storefront.router';
import {buildMediaUploadRouter} from '../media-upload';
import {CatalogProtocolService} from '../../integration/catalog-protocol.service';
import { buildMediaRouter } from '../media.router';

describe.skipIf(!process.env.RUN_DATABASE_TESTS)('Florelle imported database and media',()=>{
 const client=postgres(process.env.INTEGRATION_DATABASE_URL??(process.env.RUN_DATABASE_TESTS?parse(readFileSync('.env')).DATABASE_URL:process.env.DATABASE_URL)!,{max:1});
 const app=Fastify();
 let source:any; let catalog:CatalogService;
 beforeAll(async()=>{
  source=JSON.parse(await readFile('import-data/catalog.json','utf8'));
  const fx={markup:2.5,getRate:async(c:string)=>source.rates.rates[c],convert:async(a:string,c:string)=>(Number(a)*source.rates.rates[c]).toFixed(2),convertRetail:async(a:string,c:string)=>(Number(a)*2.5*source.rates.rates[c]).toFixed(2)} as FxService;
  const db=drizzle(client) as Database;catalog=new CatalogService(db,fx);
  app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  await app.register(buildStorefrontRouter(db,catalog,fx),{prefix:'/api/v1'});await app.register(buildMediaRouter());
 });
 afterAll(async()=>{await app.close();await client.end();});
 it('preserves all IDs, exact prices and all relational counts after repeated import',async()=>{
  const rows=await client`select id,wholesale_price,retail_price,reference_price,available_stems from listings`;
  expect(rows).toHaveLength(1000);
  const byId=new Map(rows.map(r=>[r.id,r]));
  for(const item of source.items){const row=byId.get(item.id)!;expect(Number(row.retail_price)).toBe(Number(item.seller_price));expect(Number(row.wholesale_price)).toBe(Number(item.wholesale.seller_price));expect(Number(row.reference_price)).toBe(Number(item.wholesale.ams_price));expect(row.available_stems).toBe(item.available_units);}
  const [counts]=await client`select (select count(*)::int from products) products,(select count(*)::int from categories) categories,(select count(*)::int from collection_items) memberships,(select count(*)::int from media_assets) media`;
  expect(counts).toEqual({products:511,categories:31,memberships:55,media:2443});
 });
 it('searches, filters multiple categories and paginates without duplicates',async()=>{
  const first=await catalog.getListings(productsQuerySchema.parse({sort:'featured',segment:'b2c'}));
  const next=await catalog.getListings(productsQuerySchema.parse({sort:'featured',segment:'b2c',page:2}));
  expect(first.items).toHaveLength(24);expect(first.total).toBe(1000);expect(first.items[0]?.id).toBe(source.items[0].id);
  expect(new Set([...first.items,...next.items].map(i=>i.id)).size).toBe(48);
  const found=await catalog.getListings(productsQuerySchema.parse({q:'Mondial',categories:'rose-1,calla-6'}));
  expect(found.total).toBeGreaterThan(0);expect(found.items.every(i=>i.product.name.toLowerCase().includes('mondial'))).toBe(true);
  const prices=await catalog.getListings(productsQuerySchema.parse({segment:'b2c',min_price:100,max_price:110,sort:'price_asc'}));
  expect(prices.items.length).toBeGreaterThan(0);expect(prices.items.every(i=>Number(i.seller_price)>=100&&Number(i.seller_price)<=110)).toBe(true);
 });
 it('keeps color-group priority and includes only explicitly mixed colors',async()=>{
  const group=(item:any)=>{const c=(item.color||item.product.slug).toLowerCase();if(/pink|peach|salmon/.test(c))return 'pink';if(/white|cream/.test(c))return 'white';if(/yellow/.test(c))return 'yellow';if(/orange/.test(c))return 'orange';if(/red|burgundy/.test(c))return 'red';if(/lilac|purple|lavand/.test(c))return 'purple';if(/green/.test(c))return 'green';if(/(^|[^a-z])(multicolor|mixed)([^a-z]|$)/.test((item.color||'').toLowerCase()))return 'mixed';return '';};
  const result=await catalog.getListings(productsQuerySchema.parse({colors:'pink,mixed'}));
  expect(result.total).toBe(source.items.filter((i:any)=>['pink','mixed'].includes(group(i))).length);
 });
 it('returns source collections, tariffs, aliases and serves byte-identical immutable photos',async()=>{
  const response=await app.inject('/api/v1/storefront/content?currency=RUB&segment=b2c');expect(response.statusCode).toBe(200);
  const body=response.json();expect(body.collections).toEqual(source.collections);expect(body.featured).toHaveLength(8);expect(body.categories).toHaveLength(31);expect(body.countries).toHaveLength(3);
  expect(body.media['/catalog/cutouts/1018.webp']).toEqual(body.media['/catalog/cutouts/27132.webp']);
  const quality=JSON.parse(await readFile('import-data/image-quality.json','utf8'));const hash=quality[source.items[0].image].sha256;
  const image=await app.inject(body.featured[0].image);expect(image.statusCode).toBe(200);expect(createHash('sha256').update(image.rawPayload).digest('hex')).toBe(hash);
  expect((await app.inject({url:body.featured[0].image,headers:{'if-none-match':image.headers.etag!}})).statusCode).toBe(304);
  expect((await app.inject('/media/../../.env')).statusCode).toBe(404);
 });
 it('uploads and persists variant metadata idempotently with an authenticated DB transaction',async()=>{
  const root=await mkdtemp(join(tmpdir(),'florelle-upload-db-'));const rollback=new Error('test rollback');
  try{await drizzle(client).transaction(async tx=>{
   const server=Fastify();await server.register(buildMediaUploadRouter(tx as Database,{adminToken:'test-upload',mediaRoot:root}));
   try{
    const payload=await readFile(new URL('./fixtures/cutout.webp',import.meta.url));
    const request={method:'POST' as const,url:'/admin/integration/media',headers:{authorization:'Bearer test-upload','content-type':'image/webp'},payload};
    const first=await server.inject(request);expect(first.statusCode).toBe(201);expect(first.json().variants.length).toBeGreaterThan(0);
    const second=await server.inject(request);expect(second.json()).toEqual(first.json());
   }finally{await server.close();}
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}finally{await rm(root,{recursive:true,force:true});}
 });
 it('admin price updates reach authoritative native columns without changing independent retail values',async()=>{
  const rollback=new Error('test rollback');
  try{await drizzle(client).transaction(async tx=>{
   const protocol=new CatalogProtocolService(tx as Database);const page=await protocol.listOffers({limit:1});const current=page.items[0]!;
   expect(current.price.currency).toBe('RUB');
   const body={price:{amountMinor:5500,currency:'RUB',scale:100},attributes:{retailPrice:'160.23',referencePrice:'80.01'}};
   const result=await protocol.updateOffer({actor:{actorId:'test',idempotencyKey:randomUUID(),requestId:randomUUID(),siteKey:'florelle'},ifMatch:current.revision,method:'PATCH',path:'/offers/'+current.id,rawBody:Buffer.from(JSON.stringify(body))},current.id,body);
   expect(result.status).toBe(200);
   const value=await new CatalogService(tx as Database,{getRate:async()=>1} as FxService).getListingById(current.id,'RUB','ru','b2c');
   expect(value.seller_price).toBe('160.23');expect(value.wholesale?.seller_price).toBe('55.00');expect(value.wholesale?.ams_price).toBe('80.01');
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });

 it('keeps homepage available and chosen order when featured or collection entries disappear',async()=>{
  const rollback=new Error('test rollback');
  try{await drizzle(client).transaction(async tx=>{
   const [first,second,third]=source.items;
   await tx.update(listings).set({isActive:false}).where(eq(listings.id,first.id));
   await tx.update(storefrontSettings).set({value:[first.id,randomUUID(),second.id,third.id]}).where(eq(storefrontSettings.key,'featuredListingIds'));
   const collection=source.collections[0];const disabled=source.items.find((i:any)=>i.id===collection.listingIds[0]);
   await tx.update(products).set({isActive:false}).where(eq(products.id,disabled.product.id));
   const fx={getRate:async(c:string)=>source.rates.rates[c]} as FxService;
   const service=new CatalogService(tx as Database,fx);const server=Fastify();server.setValidatorCompiler(validatorCompiler);server.setSerializerCompiler(serializerCompiler);
   await server.register(buildStorefrontRouter(tx as Database,service,fx));
   try{
    const response=await server.inject('/storefront/content?segment=b2c');expect(response.statusCode).toBe(200);
    expect(response.json().featured.map((i:any)=>i.id)).toEqual([second.id,third.id]);
    expect(response.json().collections[0].listingIds).not.toContain(disabled.id);
    expect(response.json().collections[0].productIds).not.toContain(disabled.product.id);
    expect((await service.getCollectionBySlug(collection.slug,'RUB','ru')).items.some(i=>i.product.id===disabled.product.id)).toBe(false);
   }finally{await server.close();}
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });

});
