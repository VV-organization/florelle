import raw from '@/data/catalog.json';
export type Currency='RUB'|'KZT'|'TRY';
export type Segment='b2c'|'b2b';
export type Listing={id:string;product:{id:string;name:string;slug:string;description:string;image_url:string;category_id:string};seller:{name:string;country:string;verified:boolean};seller_price:string;box_quantity:number;available_units:number;image:string;source_image?:string;description_en?:string;color?:string;stem_length_cm?:number;head_size?:string|null;category?:{name:string;slug:string;name_en?:string};wholesale?:{seller_price:string;ams_price:string|null;available_units:number}|null};
// One display convention for imported flower/grower names, regardless of source casing.
export function displayName(value:string){return value.trim().toLowerCase().replace(/\p{L}/u,letter=>letter.toUpperCase())}
export const listings:Listing[]=(raw.items as Listing[]).map(item=>({...item,product:{...item.product,name:displayName(item.product.name)},seller:{...item.seller,name:displayName(item.seller.name)}}));
export const rates:Record<string,number>=raw.rates.rates;
export const categories=raw.facets.categories;
export const collections=raw.collections;
export const symbols={RUB:'₽',KZT:'₸',TRY:'₺'};
export function convert(amount:number,from:Currency,to:Currency){return Math.round(amount/rates[from]*rates[to]*100)/100}
export function unitPrice(p:Listing,s:Segment,c:Currency){return convert(Number(s==='b2b'&&p.wholesale?p.wholesale.seller_price:p.seller_price),'RUB',c)}
export function itemPrice(p:Listing,s:Segment,c:Currency){return Math.round(unitPrice(p,s,c)*(s==='b2b'?p.box_quantity:1)*100)/100}
export function available(p:Listing,s:Segment){return s==='b2b'?(p.wholesale?.available_units??0):p.available_units}
export function money(n:number,c:Currency){return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:c==='RUB'?0:2}).format(n)+' '+symbols[c]}
export function categoryOf(p:Listing,en=false){return (en?p.category?.name_en:p.category?.name)||(en?'Flowers':'Цветы')}
export function colorGroup(p:Listing){const c=(p.color||p.product.slug).toLowerCase();if(/pink|peach|salmon/.test(c))return 'pink';if(/white|cream/.test(c))return 'white';if(/yellow/.test(c))return 'yellow';if(/orange/.test(c))return 'orange';if(/red|burgundy/.test(c))return 'red';if(/lilac|purple|lavand/.test(c))return 'purple';if(/green/.test(c))return 'green';return 'mixed'}
export const colorNames:Record<string,[string,string,string]>={pink:['Розовый','Pink','#e5a7bb'],white:['Белый','White','#fff'],yellow:['Жёлтый','Yellow','#e5cf7b'],orange:['Оранжевый','Orange','#dc895e'],red:['Красный','Red','#9f344b'],purple:['Сиреневый','Purple','#a488b2'],green:['Зелёный','Green','#839970'],mixed:['Микс','Mixed','#bdad9f']};

// Resolve snapshots of old order images to the reviewed transparent originals.
const flowerImages=new Map(listings.filter(p=>p.source_image).map(p=>[p.source_image!,p.image]));
export function flowerImage(src:string){return flowerImages.get(src)||src}
