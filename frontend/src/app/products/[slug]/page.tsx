import {notFound} from 'next/navigation';
import {serverApi} from '@/lib/server-api';
import type {Listing,Photo} from '@/lib/catalog';
import {ProductScreen} from '@/components/route-views';
type Detail=Listing['product']&{image:string;photo?:Photo;description_en?:string;category?:Listing['category'];color?:string;stem_length_cm?:number;head_size?:string;listings:(Omit<Listing,'product'|'image'>&{ams_price:string})[]};
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{listing?:string}>}){
 const {slug}=await params,{listing}=await searchParams;
 const path='/products/'+encodeURIComponent(slug)+'?currency=RUB&lang=ru&segment=';
 let retail:Detail,wholesale:Detail;
 try{[retail,wholesale]=await Promise.all([serverApi<Detail>(path+'b2c'),serverApi<Detail>(path+'b2b')])}catch(error){if(error instanceof Error&&error.message.includes('(404)'))notFound();throw error}
 const offers:Listing[]=retail.listings.map(l=>{const w=wholesale.listings.find(x=>x.id===l.id);return {...l,product:{id:retail.id,name:retail.name,slug:retail.slug,description:retail.description,image_url:retail.image_url,category_id:retail.category_id},image:retail.image,photo:retail.photo,description_en:retail.description_en,category:retail.category,color:retail.color,stem_length_cm:retail.stem_length_cm,head_size:retail.head_size,wholesale:w?{seller_price:w.seller_price,ams_price:w.ams_price,available_units:w.available_units}:null}});
 const product=offers.find(x=>x.id===listing)||offers[0];if(!product)notFound();
 const related=await serverApi<{items:Listing[]}>('/products?currency=RUB&lang=ru&segment=b2c&limit=8&category='+encodeURIComponent(retail.category?.slug||''));
 return <ProductScreen product={product} offers={offers} related={related.items.filter(p=>p.product.id!==product.product.id).filter((p,i,a)=>a.findIndex(x=>x.product.id===p.product.id)===i).slice(0,4)}/>;
}
