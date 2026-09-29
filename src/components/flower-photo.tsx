import type {ImgHTMLAttributes} from 'react';
import {photoAsset} from '@/lib/photo-assets';

/** Browser chooses the restored resolution appropriate for layout and pixel density. */
export default function FlowerPhoto({src,sizes='(max-width: 700px) 100vw, 50vw',...props}:ImgHTMLAttributes<HTMLImageElement>){
 const asset=typeof src==='string'?photoAsset(src):undefined;
 if(!asset)return <img {...props} src={src}/>;
 const largest=asset.variants.at(-1)!;
 return <img {...props} src={largest.src} sizes={sizes} srcSet={asset.variants.map(v=>`${v.src} ${v.width}w`).join(', ')} decoding="async"/>;
}
