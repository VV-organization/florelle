import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient,ApiError} from '../src/lib/api-client.ts';

test('restores a cookie session and sends bearer only in memory',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const client=createApiClient(async(url,init)=>{calls.push({url:String(url),init:init!});return Response.json(String(url).endsWith('/refresh')?{accessToken:'fresh'}:{id:'user'});});
 await client.restore();assert.deepEqual(await client.request('/auth/me'),{id:'user'});
 assert.equal(calls[0].init.credentials,'include');assert.equal(new Headers(calls[1].init.headers).get('Authorization'),'Bearer fresh');
});
test('concurrent expired requests refresh once and retry with new bearer',async()=>{
 let refreshes=0;const client=createApiClient(async(url,init)=>{if(String(url).endsWith('/refresh')){refreshes++;await new Promise(r=>setTimeout(r,5));return Response.json({accessToken:'new'});}return new Headers(init?.headers).get('Authorization')==='Bearer new'?Response.json({ok:true}):Response.json({error:{code:'UNAUTHORIZED',message:'Expired'}},{status:401});});
 client.setToken('old');await Promise.all([client.request('/cart'),client.request('/auth/me')]);assert.equal(refreshes,1);
});
test('cart rejection retains backend code and message and never retries mutation',async()=>{
 let calls=0;const client=createApiClient(async()=>{calls++;return Response.json({error:{code:'INSUFFICIENT_STOCK',message:'Stock changed'}},{status:409});});
 await assert.rejects(client.request('/cart/items',{method:'POST',body:JSON.stringify({quantity:3})}),(e:unknown)=>e instanceof ApiError&&e.code==='INSUFFICIENT_STOCK'&&e.message==='Stock changed');assert.equal(calls,1);
});
test('204 delete succeeds and missing refresh cookie is a guest',async()=>{
 const client=createApiClient(async url=>String(url).endsWith('/refresh')?new Response(null,{status:401}):new Response(null,{status:204}));assert.equal(await client.restore(),false);assert.equal(await client.request('/cart/items/id',{method:'DELETE'}),undefined);
});
test('transient refresh errors remain visible instead of silently signing out',async()=>{
 const client=createApiClient(async()=>{throw new TypeError('Network unavailable')});await assert.rejects(client.restore(),/Network unavailable/);
});
