import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5194';
const catalog=JSON.parse(readFileSync(new URL('../src/data/catalog.json',import.meta.url),'utf8'));
async function req(path:string,body?:unknown,cookie?:string,method='POST',origin=base){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();return{response,data}}
test('catalog has 1000 unique listings and local original images',()=>{assert.equal(catalog.items.length,1000);assert.equal(new Set(catalog.items.map((x:{id:string})=>x.id)).size,1000);for(const p of catalog.items){assert.match(p.image,/^\/catalog\//);assert.ok(Number(p.seller_price)>0);assert.ok(p.wholesale);assert.ok(p.box_quantity>0)}});
test('account, session, validated order drafts and logout',async()=>{const email='qa-'+randomUUID()+'@example.test';const password='Flower-Test-'+randomUUID();const signup=await req('/api/account',{action:'register',name:'Проверка магазина',phone:'+7 900 111 22 33',email,password});assert.equal(signup.response.status,200,JSON.stringify(signup.data));assert.equal(signup.data.user.email,email);assert.equal(signup.data.user.phone,'+7 900 111 22 33');assert.equal(signup.data.user.password,undefined);const cookie=signup.response.headers.get('set-cookie')!.split(';')[0];assert.match(signup.response.headers.get('set-cookie')!,/HttpOnly/i);
 const me=await req('/api/account',undefined,cookie,'GET');assert.equal(me.data.user.email,email);
 const wrong=await req('/api/account',{action:'login',email,password:'wrong-password'});assert.equal(wrong.response.status,400);
 const csrf=await req('/api/account',{action:'logout'},cookie,'POST','https://untrusted.example');assert.equal(csrf.response.status,400);
 const tomorrow=new Date(Date.now()+2*86400000).toISOString().slice(0,10);const quantity=Math.ceil(1000/Number(catalog.items[0].seller_price));const payload={items:[{id:catalog.items[0].id,segment:'b2c',quantity}],currency:'RUB',country:'RU',city:'Moscow',mode:0,kg:10,recipient:'Тестовый получатель',phone:'+7 999 123 45 67',address:'Тестовый адрес, 1',date:tomorrow,window:'09:00–13:00',note:'Автоматическая проверка заказа.'};
 const invalid=await req('/api/orders',{...payload,items:[{...payload.items[0],quantity:-5}]},cookie);assert.equal(invalid.response.status,400);
 const duplicate=await req('/api/orders',{...payload,items:[...payload.items,...payload.items]},cookie);assert.equal(duplicate.response.status,400);
 const phone=await req('/api/orders',{...payload,phone:'12345'},cookie);assert.equal(phone.response.status,400);
 const belowMinimum=await req('/api/orders',{...payload,items:[{...payload.items[0],quantity:1}]},cookie);assert.equal(belowMinimum.response.status,400);assert.match(belowMinimum.data.error,/1 000 ₽/);
 const order=await req('/api/orders',payload,cookie);assert.equal(order.response.status,201);assert.equal(order.data.status,'draft');
 const history=await req('/api/orders',undefined,cookie,'GET');assert.equal(history.data.orders[0].id,order.data.id);assert.equal(history.data.orders[0].total,Math.round((Number(catalog.items[0].seller_price)*quantity+350)*100)/100);assert.equal(history.data.orders[0].items[0].quantity,quantity);assert.equal(history.data.orders[0].city,'Moscow');
 const second=await req('/api/account',{action:'register',name:'Второй покупатель',email:'qa-'+randomUUID()+'@example.test',password});assert.equal(second.response.status,200);const otherCookie=second.response.headers.get('set-cookie')!.split(';')[0];const otherOrders=await req('/api/orders',undefined,otherCookie,'GET');assert.deepEqual(otherOrders.data.orders,[]);
 const guest=await req('/api/orders',undefined,undefined,'GET');assert.equal(guest.response.status,401);
 const wholesale=await req('/api/orders',{...payload,items:[{...payload.items[0],segment:'b2b'}],kg:9},cookie);assert.equal(wholesale.response.status,400);
 const logout=await req('/api/account',{action:'logout'},cookie);assert.equal(logout.response.status,200);const after=await req('/api/account',undefined,cookie,'GET');assert.equal(after.data.user,null);
});

test('production serves approved fonts and excludes design studies',async()=>{
 for(const font of ['prata','manrope-variable','passions-conflict-rus']){
  const response=await fetch(`${base}/fonts/${font}.woff2`);
  assert.equal(response.status,200,font);
  const bytes=new Uint8Array(await response.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'wOF2',font);
 }
 for(const path of ['/type-study/index.html','/type-study/pairings.html','/fonts/comforter-brush.woff2','/fonts/owners-wide-medium.woff2']){
  const response=await fetch(base+path);assert.equal(response.status,404,path);
 }
});
