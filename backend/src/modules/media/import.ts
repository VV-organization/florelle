import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { NewProduct, NewCategory } from '../../shared/db/schema/products';
import type { NewListing } from '../../shared/db/schema/listings';
import type { NewSeller } from '../../shared/db/schema/sellers';
import type { NewCollection, NewCollectionItem } from '../../shared/db/schema/collections';
import type { MediaPhoto } from '../../shared/db/schema/storefront';

export const mediaAliases: Record<string,string> = {'/catalog/cutouts/1018.webp':'/catalog/cutouts/27132.webp','/catalog/restored/3730.png':'/catalog/cutouts/3730.webp'};
export const retailRates={RU:[350,700,500,10000],KZ:[2500,4500,3500,25000],TR:[100,150,120,2500]};
export interface SourceCatalog {
 items: Array<{id:string;product:{id:string;name:string;slug:string;description:string;category_id:string};seller:{id:string;name:string;slug:string;country:string;verified:boolean};seller_price:string;box_quantity:number;available_units:number;delivery_date:string;image:string;source_image?:string;color:string;stem_length_cm:number|null;head_size:string|null;category:{name:string;name_en:string;slug:string};wholesale:{seller_price:string;ams_price:string;available_units:number};description_en:string}>;
 collections: Array<{id:string;name:string;slug:string;image_url:string|null;listingIds:string[];productIds:string[];product_count:number}>;
 rates:{rates:Record<string,number>;fetched_at:string};
}
const localize=(ru:string,en=ru)=>({ru,en});
const displayName=(s:string)=>s.trim().toLowerCase().replace(/\p{L}/u,c=>c.toUpperCase());
export function prepareImport(source: SourceCatalog, media:Record<string,MediaPhoto>) {
 const products=new Map<string,NewProduct>(), categories=new Map<string,NewCategory>(), sellers=new Map<string,NewSeller>();
 const listings:NewListing[]=[]; const seen=new Set<string>();
 for(const [index,item] of source.items.entries()) {
  if(seen.has(item.id))throw new Error(`Duplicate listing ${item.id}`); seen.add(item.id);
  for(const price of [item.seller_price,item.wholesale.seller_price,item.wholesale.ams_price])if(!/^\d+(\.\d{1,6})?$/.test(price))throw new Error(`Invalid exact price ${item.id}`);
  if(!Number.isInteger(item.available_units)||item.available_units<0||item.box_quantity<1)throw new Error(`Invalid stock ${item.id}`);
  const photo=media[item.image];
  if(!products.has(item.product.id)) products.set(item.product.id,{id:item.product.id,name:localize(displayName(item.product.name)),slug:item.product.slug,species:item.category.name_en,color:item.color??'',stemLengthCm:item.stem_length_cm,headSize:item.head_size,imageUrl:photo?.url??item.image,photo:photo??null,description:localize(item.product.description,item.description_en),categoryId:item.product.category_id,sortOrder:index});
  categories.set(item.product.category_id,{id:item.product.category_id,name:localize(item.category.name,item.category.name_en),slug:item.category.slug});
  sellers.set(item.seller.id,{id:item.seller.id,name:localize(displayName(item.seller.name)),slug:item.seller.slug,country:item.seller.country,verified:item.seller.verified,logoUrl:null});
  const rubRate=source.rates.rates.RUB!;
  listings.push({id:item.id,productId:item.product.id,sellerId:item.seller.id,priceCurrency:'RUB',retailPrice:item.seller_price,wholesalePrice:item.wholesale.seller_price,referencePrice:item.wholesale.ams_price,sellerPriceUsd:(Number(item.wholesale.seller_price)/rubRate).toFixed(2),amsPriceUsd:(Number(item.wholesale.ams_price)/rubRate).toFixed(2),boxQuantity:item.box_quantity,availableStems:item.available_units,deliveryDate:item.delivery_date,sortOrder:index});
 }
 const collections:NewCollection[]=source.collections.map((c,i)=>({id:c.id,name:localize(c.name,({'best-sellers':'Bestsellers','premium-roses':'Premium roses','spring-collection':'Summer collection'} as Record<string,string>)[c.slug]??c.name),slug:c.slug,type:'editorial',imageUrl:c.image_url?media[c.image_url]?.url??c.image_url:null,sortOrder:i}));
 const collectionItems:NewCollectionItem[]=source.collections.flatMap(c=>c.listingIds.map((id,i)=>{if(!seen.has(id))throw new Error(`Unknown collection listing ${id}`);return {collectionId:c.id,listingId:id,sortOrder:i};}));
 const floral=source.items.filter(p=>['peonies-25','hydrangea-24','tulip-3'].includes(p.category.slug)).filter((p,i,a)=>a.findIndex(x=>x.product.id===p.product.id)===i).slice(0,4);
 const featuredListingIds=[...([0,1,2,13].map(i=>source.items[i]).filter(Boolean)),...floral].map(p=>p!.id);
 return {featuredListingIds,products:[...products.values()],categories:[...categories.values()],sellers:[...sellers.values()],listings,collections,collectionItems};
}
export interface QualityPhoto { original:number[];variants:Array<{src:string;width:number;height:number}>; [key:string]:unknown }
export async function scanMedia(publicDir:string,mediaRoot:string,quality:Record<string,QualityPhoto>,framing:Record<string,MediaPhoto['framing']>,apply=false,aliases=mediaAliases) {
 const files:Array<{sourcePath:string;checksum:string;filename:string;bytes:number;contentType:string}>=[];
 const media:Record<string,MediaPhoto>={};
 const types:Record<string,string>={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.avif':'image/avif'};
 async function walk(relative='') {
  for(const entry of (await readdir(join(publicDir,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
   const path=join(relative,entry.name);
   if(entry.isDirectory()) {await walk(path);continue;}
   const ext=extname(path).toLowerCase();if(!types[ext]||!entry.isFile())continue;
   const data=await readFile(join(publicDir,path));const checksum=createHash('sha256').update(data).digest('hex');const filename=checksum+ext;const sourcePath='/'+path;
   if(apply){await mkdir(mediaRoot,{recursive:true});await writeFile(join(mediaRoot,filename),data);}
   files.push({sourcePath,checksum,filename,bytes:data.length,contentType:types[ext]!});
   media[sourcePath]={url:'/media/'+filename,variants:[]};
  }
 }
 await walk();
 for(const [source,info] of Object.entries(quality)) {
  const entry=media[source];if(!entry)throw new Error(`Missing photo ${source}`);
  entry.variants=info.variants.map(v=>{const asset=media[v.src];if(!asset)throw new Error(`Missing variant ${v.src}`);return {...v,src:asset.url};});
  if(framing[source])entry.framing=framing[source];
 }
 for(const [source,frame] of Object.entries(framing))if(media[source])media[source]!.framing=frame;
 for(const [alias,target] of Object.entries(aliases)) {if(!media[target])throw new Error(`Missing alias target ${target}`);media[alias]={...media[target]!};}
 return {files,media};
}
