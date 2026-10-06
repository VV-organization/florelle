'use client';
import type {ImgHTMLAttributes} from 'react';
import type {Photo} from '@/lib/catalog';
import {useShop} from './shop-context';
export default function FlowerPhoto({src,photo,sizes='(max-width: 700px) 100vw, 50vw',...props}:ImgHTMLAttributes<HTMLImageElement>&{photo?:Photo}){
 const {content}=useShop();const asset=photo||(typeof src==='string'?content.media[src]:undefined);const variants=asset?.variants||[];
 if(!variants.length)return <img {...props} src={asset?.url||src}/>;
 return <img {...props} src={variants.at(-1)!.src} sizes={sizes} srcSet={variants.map(v=>`${v.src} ${v.width}w`).join(', ')} decoding="async"/>;
}
