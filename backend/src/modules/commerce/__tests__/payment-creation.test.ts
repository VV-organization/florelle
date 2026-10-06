import {it,expect,vi} from 'vitest';
import {ArcopayPaymentProvider} from '../../payments/arcopay-payment-provider';
it('returns provider identity before any QRC request and uses the persisted RUB amount',async()=>{
 const calls:string[]=[];const provider=new ArcopayPaymentProvider({apiUrl:'https://provider.test',apiKey:'test',bearerToken:'test',publicKey:'test',convertUsdToRub:async()=>{throw Error('must use snapshot')},fetchFn:async(url,init)=>{calls.push(String(url));expect(JSON.parse(String(init?.body)).Amount).toBe(141781);return Response.json({Response:{Success:true},Order:{OrderId:'external',MerchantOrderId:'merchant',Amount:141781,Currency:'RUB'}})}});
 const create=provider as unknown as {createPaymentOrder:(p:unknown)=>Promise<{externalId:string}>};
 expect(typeof create.createPaymentOrder).toBe('function');
 await expect(create.createPaymentOrder({merchantOrderId:'merchant',amountUsd:'14.18',amountMinor:141781,description:'order',callbackUrl:'https://shop.test/api/v1/payments/callback'})).resolves.toEqual({externalId:'external'});
 expect(calls).toEqual(['https://provider.test/payments/create']);
});
