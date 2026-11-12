'use client';
import MotionText from '@/components/motion-text';

import {useRef,useState} from 'react';
import BotanicalScene from './botanical-scene';
import Link from 'next/link';
import {useShop} from './shop-context';
export default function Hero({en=false}:{en?:boolean}){
 const ref=useRef<HTMLDivElement>(null);
 const shop=useShop();
 const [expanded,setExpanded]=useState(false);
 function move(e:React.PointerEvent){const el=ref.current;if(!el)return;const r=el.getBoundingClientRect();el.style.setProperty('--mx',`${e.clientX-r.left}px`);el.style.setProperty('--my',`${e.clientY-r.top}px`);el.classList.add('is-blooming')}
 return <section className={'hero'+(expanded?' show-bloom':'')} ref={ref} onPointerMove={move} onPointerLeave={()=>ref.current?.classList.remove('is-blooming')}>
 <div className="botanical botanical-green"/><div className="botanical botanical-bloom"/><BotanicalScene expanded={expanded}/>
 <div className="hero-topline"><span>{en?'BLOOM-SEND · FLOWERS DIRECT FROM GROWERS':'BLOOM-SEND · ПОСТАВКИ ЦВЕТОВ С ПЛАНТАЦИЙ'}</span></div>
 <div className="hero-copy"><MotionText as="h1" singleLine={false}>{en?'Flowers from growers in Ecuador and Colombia.':'Цветы с плантаций Эквадора и Колумбии.'}</MotionText><MotionText as="p">{en?'Roses, peonies and hydrangeas in stock. Delivery across Russia, Kazakhstan and Turkey.':'Розы, пионы, гортензии в наличии. Доставка по России, Казахстану и Турции.'}</MotionText><Link className="button cream" href={'/catalog?segment='+shop.segment}>{en?'Browse catalogue':'Перейти в каталог'}</Link></div>
 <button className="bloom-hint" onClick={()=>setExpanded(v=>!v)} aria-pressed={expanded} aria-label={expanded?(en?'Return to greenery':'Вернуть зелень'):(en?'Let the flowers bloom':'Раскрыть цветы')}><span className="bloom-dot">✳</span><span>{expanded?(en?'Return to greenery':'Вернуть зелень'):(en?'Touch to bloom':'Прикоснитесь — и всё расцветёт')}</span></button>
 <div className="hero-bottom"><span>{en?'DIRECT SUPPLY · RUSSIA · KAZAKHSTAN · TURKEY':'ПРЯМЫЕ ПОСТАВКИ · РФ · КАЗАХСТАН · ТУРЦИЯ'}</span><a href="#selection">{en?'To the catalogue':'К каталогу'} <span>↓</span></a></div>
 </section>
}
