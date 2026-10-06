import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
const origin='http://127.0.0.1:5194';
const dbUrl=new URL(process.env.DATABASE_URL);
assert(['localhost','127.0.0.1'].includes(dbUrl.hostname),'Local database only');
assert.equal(process.env.PAYMENT_PROVIDER,'disabled','Run only with payments disabled');
const email=`smoke-${randomUUID()}@florelle.test`;
const password=randomUUID()+'A1!';
let accessToken='',cookie='';
async function api(path,method='GET',body,expected=200){
 const response=await fetch(origin+'/api/v1'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(accessToken?{Authorization:'Bearer '+accessToken}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 const data=await response.json().catch(()=>null);
 assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${data?.error?.code??''}`);
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 return data;
}
const sql=postgres(process.env.DATABASE_URL,{max:1});
let messageId;
try{
 const challenge=await api('/auth/register','POST',{customerType:'individual',email,password,name:'Local QA',phone:'+79991234567'},202);
 const listing=(await fetch('http://127.0.0.1:58025/api/v1/messages').then(r=>r.json())).messages.find(m=>m.To.some(to=>to.Address===email));
 assert(listing,'Registration message delivered to Mailpit');messageId=listing.ID;
 const message=await fetch('http://127.0.0.1:58025/api/v1/message/'+messageId).then(r=>r.json());
 const code=message.Text.match(/Код подтверждения: (\d{6})/)?.[1];assert(code,'Registration code present');
 const auth=await api('/auth/register/verify','POST',{email,code,challengeId:challenge.challengeId});accessToken=auth.accessToken;assert.equal(auth.user.status,'active');
 const profile=await api('/auth/me','PATCH',{name:'Local QA Changed',phone:'+79991234567',company:''});assert.equal(profile.name,'Local QA Changed');
 const product=(await api('/products?currency=RUB&segment=b2c&limit=1')).items[0];
 await api('/cart/items','POST',{listingId:product.id,quantity:20,segment:'b2c'},201);
 const cart=await api('/cart?currency=RUB');assert.equal(cart.items.length,1);assert(Number(cart.total)>0);
 const countries=(await api('/storefront/content?currency=RUB&segment=b2c')).countries;
 const ru=countries.find(c=>c.code==='RU');
 const payload={segment:'b2c',displayCurrency:'RUB',shippingAddress:{address:'Москва, Тестовая улица, 1',contactName:'Local QA',contactPhone:'+79991234567'},delivery:{countryCode:'RU',cityValue:ru.cities[0].value,mode:0,date:new Date(Date.now()+86400000).toISOString().slice(0,10),window:'09:00–13:00'}};
 const quote=await api('/checkout/quote','POST',payload);assert(Number(quote.total)>0);
 const response=await fetch(origin+'/api/v1/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken,'Idempotency-Key':randomUUID()},body:JSON.stringify(payload)});
 assert.equal(response.status,503);assert.equal((await response.json()).error.code,'PAYMENTS_NOT_CONFIGURED');
 assert.equal((await api('/cart?currency=RUB')).items.length,1);
 accessToken='';const refresh=await api('/auth/refresh','POST');accessToken=refresh.accessToken;assert.equal((await api('/auth/me')).email,email);
 await api('/auth/logout','POST',undefined,204);
 console.log('PASS local SMTP registration, verification, profile, cookie refresh, authenticated cart, server quote, disabled-payment no-reservation, logout');
}finally{
 await sql`delete from users where email=${email}`;await sql.end();
 if(messageId)await fetch('http://127.0.0.1:58025/api/v1/messages',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({IDs:[messageId]})});
}
