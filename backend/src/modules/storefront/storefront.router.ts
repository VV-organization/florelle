import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Database } from '../../shared/db/client';
import type { CatalogService } from '../catalog/catalog.service';
import { storefrontSettings } from '../../shared/db/schema/storefront';
import {listings} from '../../shared/db/schema/listings';
import {sellers} from '../../shared/db/schema/sellers';
import {collections,collectionItems} from '../../shared/db/schema/collections';
import {NotFoundError} from '../../shared/middleware/error.middleware';
import { categories,products } from '../../shared/db/schema/products';
import { currencyQuerySchema, productsQuerySchema } from '../catalog/catalog.schema';
import { eq,and } from 'drizzle-orm';
import type { FxService } from '../../shared/currency/fx.service';

export function buildStorefrontRouter(db:Database,catalog:CatalogService,fx:FxService):FastifyPluginAsync{
 return async(app)=>{
  app.withTypeProvider<ZodTypeProvider>().get('/storefront/content',{schema:{tags:['storefront'],querystring:currencyQuerySchema}},async(request)=>{
   const [rows,categoryRows,result,memberships]=await Promise.all([
    db.select().from(storefrontSettings),
    db.select().from(categories).where(eq(categories.isActive,true)),
    catalog.getListings(productsQuerySchema.parse({...request.query,sort:'featured',limit:8})),
    db.select({collectionId:collections.id,listingId:listings.id,productId:products.id}).from(collectionItems)
     .innerJoin(collections,eq(collectionItems.collectionId,collections.id))
     .innerJoin(listings,eq(collectionItems.listingId,listings.id))
     .innerJoin(products,eq(listings.productId,products.id)).innerJoin(sellers,eq(listings.sellerId,sellers.id))
     .where(and(eq(collections.isActive,true),eq(listings.isActive,true),eq(products.isActive,true),eq(sellers.isActive,true))),
   ]);
   const values=Object.fromEntries(rows.map(row=>[row.key,row.value]));
   const featuredIds=Array.isArray(values.featuredListingIds)?values.featuredListingIds.filter((id):id is string=>typeof id==='string').slice(0,8):[];
   const featured=featuredIds.length?(await Promise.all(featuredIds.map(async id=>{
    try{return await catalog.getListingById(id,request.query.currency,request.query.lang,request.query.segment);}
    catch(error){if(error instanceof NotFoundError)return null;throw error;}
   }))).filter((item):item is NonNullable<typeof item>=>item!==null):result.items;
   const liveCollections=(Array.isArray(values.collections)?values.collections:[]).map((collection:Record<string,unknown>)=>{
    const members=memberships.filter(m=>m.collectionId===collection.id);
    const listingIds=new Set(members.map(m=>m.listingId));const productIds=new Set(members.map(m=>m.productId));
    const chosenIds=(Array.isArray(collection.listingIds)?collection.listingIds:[]).filter(id=>listingIds.has(id));
    return {...collection,listingIds:chosenIds,productIds:(Array.isArray(collection.productIds)?collection.productIds:[]).filter(id=>productIds.has(id)),product_count:chosenIds.length};
   });
   const names=new Map(categoryRows.map(row=>[row.slug,row.name.en]));
   const rates={USD:1,RUB:await fx.getRate('RUB'),KZT:await fx.getRate('KZT'),TRY:await fx.getRate('TRY')};
   return {categories:result.facets.categories.map(c=>({...c,name_en:names.get(c.slug)??c.name})),collections:liveCollections,featured,countries:values.delivery??[],retailRates:values.retailRates??{},media:values.media??{},rates};
  });
 };
}
