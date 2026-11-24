import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ArcopayPaymentProvider } from '../arcopay-payment-provider';
const order = {OrderId:'provider-1',MerchantOrderId:'merchant-1',Amount:5034,Currency:'RUB',ShopId:1581,Status:'CREATED'};
const response = (patch={}) => ({Response:{Success:true},Order:{...order,...patch}});
const config = {apiUrl:'https://api.clickit.team/api/v1',apiKey:'test-key',bearerToken:'test-token',publicKey:'unused',shopId:'1581',convertUsdToRub:async()=> '50.34'};
describe('Arco Pay shared hosted checkout',()=>{
 it('creates SBP-only hosted checkout once using the exact amount and durable key',async()=>{
  const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(Response.json(response()));
  const provider=new ArcopayPaymentProvider({...config,fetchFn});
  await expect(provider.createPayment({merchantOrderId:'merchant-1',amountUsd:'1',amountMinor:5034,description:'Bloom-send order',callbackUrl:'https://shop.test/api/v1/payments/callback',successUrl:'https://shop.test/orders/1',failUrl:'https://shop.test/orders/1',idempotencyKey:'attempt-1'})).resolves.toEqual({externalId:'provider-1',paymentUrl:'https://payment.paidlayer.com/provider-1'});
  expect(fetchFn).toHaveBeenCalledOnce();
  const [url,init]=fetchFn.mock.calls[0]!;
  expect(url).toBe(config.apiUrl+'/payments/create');
  expect(init).toMatchObject({redirect:'error',headers:{'x-req-id':'attempt-1','x-api-key':'test-key',Authorization:'Bearer test-token'}});
  expect(JSON.parse(String(init?.body))).toMatchObject({Amount:5034,PaymentTypes:['IPS'],IsForm:true,LifeTime:900,RedirectUrl:{SuccessUrl:'https://shop.test/orders/1',FailUrl:'https://shop.test/orders/1'}});
 });
 it('gets a hosted URL without making another provider request',async()=>{
  const fetchFn=vi.fn(); const provider=new ArcopayPaymentProvider({...config,fetchFn});
  expect((await provider.getPaymentUrl({externalId:'provider-1',description:'order'})).paymentUrl).toBe('https://payment.paidlayer.com/provider-1');
  await expect(provider.getPaymentUrl({externalId:'../evil',description:'order'})).rejects.toThrow();
  expect(fetchFn).not.toHaveBeenCalled();
 });
 it.each([{OrderId:undefined},{ShopId:1502},{Amount:0},{Currency:'USD'},{OrderId:'../evil'},{Status:'CHARGED',PaymentType:'IPS'},{Status:'IPS_ACCEPTED',PaymentType:'CARD'}])('rejects invalid provider identity or money %j',patch=>{
  expect(()=>new ArcopayPaymentProvider(config).parseWebhookPayload(response(patch))).toThrow();
 });
 it.each([['CHARGED','CARD','paid'],['IPS_ACCEPTED','IPS','paid'],['AUTHORIZED','CARD','pending'],['QRCDATA_CREATED','IPS','pending'],['EXPIRED','','failed']])('maps %s without treating intermediate status as payment', (Status,PaymentType,status)=>{
  expect(new ArcopayPaymentProvider(config).parseWebhookPayload(response({Status,PaymentType})).status).toBe(status);
 });
 it('checks status by exact provider ID',async()=>{
  const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(Response.json(response({Status:'IPS_ACCEPTED',PaymentType:'IPS'})));
  const provider=new ArcopayPaymentProvider({...config,fetchFn});
  await expect(provider.getPaymentStatus('provider-1')).resolves.toMatchObject({status:'paid',amountMinor:5034,currency:'RUB'});
  fetchFn.mockResolvedValue(Response.json(response({OrderId:'different'})));
  await expect(provider.getPaymentStatus('provider-1')).rejects.toThrow();
 });
 it('verifies exact raw bytes with an escaped PEM public key',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const raw=Buffer.from('{"ok":true}');
  const signature=createSign('RSA-SHA1').update(raw).end().sign(privateKey,'base64');
  const provider=new ArcopayPaymentProvider({...config,publicKey:publicKey.export({type:'spki',format:'pem'}).toString().replace(/\n/g,'\\n')});
  expect(provider.verifyWebhookSignature(raw,signature)).toBe(true);
  expect(provider.verifyWebhookSignature(Buffer.concat([raw,Buffer.from(' ')]),signature)).toBe(false);
 });
 it('bounds provider requests with a timeout', async()=>{
   const fetchFn=vi.fn<typeof fetch>().mockImplementation((_input,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason))));
   const provider=new ArcopayPaymentProvider({...config,fetchFn,requestTimeoutMs:10});
   await expect(provider.getPaymentStatus('provider-1')).rejects.toMatchObject({name:'TimeoutError'});
 });

});
