import { describe,it,expect } from 'vitest';
import {calculateQuote,validateDelivery} from '../pricing';
const rates={USD:1,RUB:100,KZT:500,TRY:50};
const countries=[{code:'RU',cities:[{value:'Moscow',rates:[72,52,38,32],minimums:[900,1800,3200,5200]}]}];
const input={segment:'b2c' as const,displayCurrency:'RUB',shippingAddress:{address:'Street 100',contactName:'Customer',contactPhone:'+7 900 123 45 67'},delivery:{countryCode:'RU' as const,cityValue:'Moscow',mode:0,date:'2099-01-01',window:'09:00–13:00'}};
const line={listingId:'one',quantity:10,boxQuantity:100,availableStems:4199,priceCurrency:'RUB',wholesalePrice:'37.97',retailPrice:'95.34',referencePrice:'49.78',sellerPriceUsd:'0.38'};
describe('authoritative quote',()=>{
 it('preserves independent imported retail cents and adds commission and shipping',()=>{const q=calculateQuote([line],input,rates,countries,12,2.5);expect(q).toMatchObject({subtotal:'953.40',commission:'114.41',shipping:'350.00',total:'1417.81',minimumMissing:'0.00'});});
 it('checks minimum before delivery can lift the order over the threshold',()=>{const q=calculateQuote([{...line,quantity:1}],input,rates,countries,12,2.5);expect(q.minimumMissing).toBe('893.22');});
 it('counts boxes as stems and rejects overselling partial boxes',()=>{const q=calculateQuote([{...line,quantity:1}],{...input,segment:'b2b'},rates,countries,12,2.5);expect(q).toMatchObject({subtotal:'3797.00',estimatedWeightKg:10,shipping:'900.00'});expect(()=>calculateQuote([{...line,quantity:42}],{...input,segment:'b2b'},rates,countries,12,2.5)).toThrow(/stock/i);});
 it('keeps express delivery charge above free threshold',()=>{const q=calculateQuote([{...line,quantity:120}],{...input,delivery:{...input.delivery,mode:1}},rates,countries,12,2.5);expect(q.shipping).toBe('700.00');});
 it('rejects unconfigured rates instead of treating currencies as equal',()=>{expect(()=>calculateQuote([line],input,{...rates,RUB:0},countries,12,2.5)).toThrow(/rate/i);});
 it('keeps settlement and minimum independent of the display currency',()=>{const fx={...rates,TRY:31.127};const rub=calculateQuote([line],input,fx,countries,12,2.5);for(const currency of ['TRY','KZT']){const q=calculateQuote([line],{...input,displayCurrency:currency},fx,countries,12,2.5);expect(q.paymentAmountMinor).toBe(rub.paymentAmountMinor);expect(q.totalUsd).toBe(rub.totalUsd);}});
 it('validates country phone and requested date server-side',()=>{expect(()=>validateDelivery({...input,delivery:{...input.delivery,date:'2020-01-01'}},countries)).toThrow();expect(()=>validateDelivery({...input,shippingAddress:{...input.shippingAddress,contactPhone:'12345'}},countries)).toThrow();});
});

for (const [now, earliest] of [
 ['2026-11-01T09:00:00Z','2026-11-03'],
 ['2026-10-31T20:59:59Z','2026-11-02'],
 ['2026-10-31T21:00:00Z','2026-11-03'],
 ['2026-12-31T12:00:00Z','2027-01-02'],
]) {
 it(`allows delivery from ${earliest} at ${now}`,()=>{
  const date = new Date(now);
  for (const offset of [1,2]) {
   const before=new Date(earliest+'T00:00:00Z');before.setUTCDate(before.getUTCDate()-offset);
   expect(()=>validateDelivery({...input,delivery:{...input.delivery,date:before.toISOString().slice(0,10)}},countries,date)).toThrow();
  }
  expect(()=>validateDelivery({...input,delivery:{...input.delivery,date:earliest}},countries,date)).not.toThrow();
 });
}
