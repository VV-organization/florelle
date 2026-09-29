import quality from '@/data/image-quality.json';

type Variant={src:string;width:number;height:number;edge:number;bytes:number};
type Photo={original:number[];method:string;passes:number;variants:Variant[]};
const photos=quality as Record<string,Photo>;
const aliases:Record<string,string>={
 '/catalog/cutouts/1018.webp':'/catalog/cutouts/27132.webp',
 '/catalog/restored/3730.png':'/catalog/cutouts/3730.webp',
};
export function photoAsset(source:string){return photos[aliases[source]||source]}
export function photoSrc(source:string){return photoAsset(source)?.variants.at(-1)?.src||source}
