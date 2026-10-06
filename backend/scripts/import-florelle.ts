import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { prepareImport, scanMedia, retailRates, type SourceCatalog, type QualityPhoto } from '../src/modules/media/import';
import { categories, products } from '../src/shared/db/schema/products';
import { listings } from '../src/shared/db/schema/listings';
import { sellers } from '../src/shared/db/schema/sellers';
import { collections, collectionItems } from '../src/shared/db/schema/collections';
import { mediaAssets, storefrontSettings, type MediaPhoto } from '../src/shared/db/schema/storefront';
import { exchangeRates } from '../src/shared/db/schema/exchange-rates';
const backend=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const apply=process.argv.includes('--apply');
const sourceDir=resolve(process.env.IMPORT_DATA_ROOT??resolve(backend,'import-data'));
const publicDir=resolve(process.env.IMPORT_PUBLIC_ROOT??resolve(backend,'../.artifacts/reference/public'));
const mediaRoot=resolve(process.env.MEDIA_ROOT??resolve(backend,'.runtime/media'));
const read=async(name:string)=>JSON.parse(await readFile(resolve(sourceDir,name+'.json'),'utf8'));
const source=await read('catalog') as SourceCatalog;
const delivery=await read('delivery');
const quality=await read('image-quality') as Record<string,QualityPhoto>;
const framing=await read('image-framing') as Record<string,MediaPhoto['framing']>;
// Validate all references and data before writes, including media bytes.
const scanned=await scanMedia(publicDir,mediaRoot,quality,framing,false);
for(const item of source.items)if(!scanned.media[item.image])throw new Error(`Missing listing media: ${item.image}`);
const plan=prepareImport(source,scanned.media);
const report={mode:apply?'apply':'dry-run',products:plan.products.length,listings:plan.listings.length,categories:plan.categories.length,sellers:plan.sellers.length,collections:plan.collections.length,collectionItems:plan.collectionItems.length,mediaFiles:scanned.files.length,uniqueMediaFiles:new Set(scanned.files.map(f=>f.filename)).size,mediaBytes:scanned.files.reduce((n,f)=>n+f.bytes,0),countries:delivery.length,mediaRoot};
if(apply){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required for --apply');
 await scanMedia(publicDir,mediaRoot,quality,framing,true);
 const client=postgres(process.env.DATABASE_URL,{max:1}); const db=drizzle(client);
 try {await db.transaction(async tx=>{
  // Existing rows are deliberately untouched: rerunning an import cannot reset sold stock.
  for(const [table,rows] of [[categories,plan.categories],[sellers,plan.sellers],[products,plan.products],[listings,plan.listings],[collections,plan.collections],[collectionItems,plan.collectionItems]] as const){
   for(let i=0;i<rows.length;i+=100)await tx.insert(table as any).values(rows.slice(i,i+100) as any).onConflictDoNothing();
  }
  for(let i=0;i<scanned.files.length;i+=100)await tx.insert(mediaAssets).values(scanned.files.slice(i,i+100).map(f=>({...f,metadata:scanned.media[f.sourcePath]!}))).onConflictDoNothing();
  for(const [key,value] of Object.entries({featuredListingIds:plan.featuredListingIds,delivery,retailRates,collections:source.collections,rates:source.rates.rates,media:scanned.media}))await tx.insert(storefrontSettings).values({key,value}).onConflictDoNothing();
  for(const [target,rate] of Object.entries(source.rates.rates))if(target!=='USD')await tx.insert(exchangeRates).values({base:'USD',target,rate:String(rate),fetchedAt:new Date(source.rates.fetched_at)}).onConflictDoNothing();
 });} finally {await client.end();}
}
console.log(JSON.stringify(report,null,2));
