import { ValidationError } from '../../shared/middleware/error.middleware';
type NativePrices={wholesalePrice?:string|null;retailPrice?:string|null;referencePrice?:string|null;sellerPriceUsd?:string;amsPriceUsd?:string};
export function nativePriceWrite(input:{price?:{amountMinor:number;currency:string};attributes?:Record<string,unknown>},current:NativePrices|null,usdRub:number,markup:number){
 if(!Number.isFinite(usdRub)||usdRub<=0)throw new ValidationError('A valid RUB exchange rate is required');
 const attributes=input.attributes??{};
 const exact=(value:unknown)=>{const text=String(value);if(!/^\d+(\.\d{1,6})?$/.test(text))throw new ValidationError('Invalid native RUB price');return text;};
 const price=input.price;
 if(price&&!['USD','RUB'].includes(price.currency))throw new ValidationError('Offer currency must be RUB or USD');
 const wholesalePrice=price?(price.amountMinor/100*(price.currency==='USD'?usdRub:1)).toFixed(2):current?.wholesalePrice??(Number(current?.sellerPriceUsd??0)*usdRub).toFixed(2);
 const retailPrice=attributes.retailPrice!==undefined?exact(attributes.retailPrice):current?.retailPrice??(Number(wholesalePrice)*markup).toFixed(2);
 const referencePrice=attributes.referencePrice!==undefined?exact(attributes.referencePrice):attributes.amsPriceUsd!==undefined?(Number(exact(attributes.amsPriceUsd))*usdRub).toFixed(2):current?.referencePrice??(current?.amsPriceUsd?(Number(current.amsPriceUsd)*usdRub).toFixed(2):wholesalePrice);
 return {priceCurrency:'RUB',wholesalePrice,retailPrice,referencePrice,sellerPriceUsd:(Number(wholesalePrice)/usdRub).toFixed(2),amsPriceUsd:(Number(referencePrice)/usdRub).toFixed(2)};
}
