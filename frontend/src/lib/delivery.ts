import {convert,type Currency} from './catalog';
import type {Content} from './storefront-types';
export type CountryCode='RU'|'KZ'|'TR';
export const countryCurrency:Record<CountryCode,Currency>={RU:'RUB',KZ:'KZT',TR:'TRY'};
export function deliveryPrice(country:CountryCode,city:string,kg:number,segment:string,mode:number,subtotal:number,currency:Currency,content:Content){
 const source=countryCurrency[country];
 if(segment==='b2c'){const r=content.retailRates[country];return convert(subtotal>=convert(r[3],source,currency,content.rates)&&mode!==1?0:r[mode],source,currency,content.rates)}
 const row=content.countries.find(x=>x.code===country)?.cities.find(x=>x.value===city);
 if(!row||!Number.isFinite(kg)||kg<=0)return null;
 const i=kg<=20?0:kg<=60?1:kg<=100?2:3;
 return convert(Math.max(row.minimums[i],Math.ceil(row.rates[i]*kg)),source,currency,content.rates);
}
