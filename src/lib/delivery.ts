import countries from '@/data/delivery.json';
import {convert,type Currency} from './catalog';
export {countries};
export type CountryCode='RU'|'KZ'|'TR';
export const countryCurrency:Record<CountryCode,Currency>={RU:'RUB',KZ:'KZT',TR:'TRY'};
export const retailRates={RU:[350,700,500,10000],KZ:[2500,4500,3500,25000],TR:[100,150,120,2500]};
export function deliveryPrice(country:CountryCode,city:string,kg:number,segment:string,mode:number,subtotal:number,currency:Currency){
 const source=countryCurrency[country];
 if(segment==='b2c'){const r=retailRates[country];return convert(subtotal>=convert(r[3],source,currency)&&mode!==1?0:r[mode],source,currency)}
 const row=countries.find(x=>x.code===country)?.cities.find(x=>x.value===city);
 if(!row||!Number.isFinite(kg)||kg<=0)return null;
 const i=kg<=20?0:kg<=60?1:kg<=100?2:3;
 return convert(Math.max(row.minimums[i],Math.ceil(row.rates[i]*kg)),source,currency);
}
