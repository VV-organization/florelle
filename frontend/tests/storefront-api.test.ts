import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL;
test('own catalog, 24-item pagination, filters and responsive media pass through Next', {skip:!base},async()=>{
 const get=async(path:string)=>{const r=await fetch(base+path);assert.equal(r.status,200,path);return r.json()};
 const content=await get('/api/v1/storefront/content?currency=RUB&segment=b2c');assert.equal(content.featured.length,8);assert.equal(content.categories.length,31);assert.equal(content.countries.reduce((n:number,c:{cities:unknown[]})=>n+c.cities.length,0),37);
 const catalog=await get('/api/v1/products?currency=RUB&segment=b2c&sort=featured');assert.equal(catalog.items.length,24);assert.equal(catalog.total,1000);
 const filtered=await get('/api/v1/products?currency=RUB&segment=b2c&category=rose-1,peonies-25&color=pink&sort=price_asc');assert.ok(filtered.total>0);assert.ok(filtered.items.every((p:{category:{slug:string}})=>['rose-1','peonies-25'].includes(p.category.slug)));assert.ok(filtered.items.every((p:{seller_price:string},i:number,a:{seller_price:string}[])=>!i||Number(p.seller_price)>=Number(a[i-1].seller_price)));
 const photo=catalog.items[0].photo;assert.ok(photo.variants.length>=3);const image=await fetch(base+photo.variants[0].src);assert.equal(image.status,200);assert.match(image.headers.get('content-type')||'',/image/);
 const detail=await get('/api/v1/products/'+catalog.items[0].product.slug+'?currency=RUB&segment=b2c');assert.ok(detail.listings.length);assert.equal(detail.id,catalog.items[0].product.id);
 for(const path of ['/api/v1/cart?currency=RUB','/api/v1/orders'])assert.equal((await fetch(base+path)).status,401,path);
});
