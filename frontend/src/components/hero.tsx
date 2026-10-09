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
 <div className="hero-topline"><span>{en?'BLOOM-SEND · FLOWER ATELIER':'BLOOM-SEND · ЦВЕТОЧНОЕ АТЕЛЬЕ'}</span></div>
 <div className="hero-copy"><MotionText as="h1" singleLine={false}><span className="hero-first-line">{en?'Flowers':'Цветы'}<span className="handwritten hero-signature" lang={en?'en':'ru'} aria-hidden="true">{en?'with love':'с любовью'}</span></span>{' '}<span className="hero-second-line">{shop.segment==='b2b'?(en?'for business':'для бизнеса'):(en?'beyond words':'вместо слов')}</span></MotionText><MotionText as="p">{en?'Some feelings need no words. Just flowers.':'Есть чувства, которым не нужны слова.\nДостаточно цветов.'}</MotionText><Link className="button cream" href={'/catalog?segment='+shop.segment}>{shop.segment==='b2b'?(en?'Explore wholesale':'Перейти в оптовый каталог'):(en?'Explore flowers':'Выбрать цветы')}</Link></div>
 <button className="bloom-hint" onClick={()=>setExpanded(v=>!v)} aria-pressed={expanded} aria-label={expanded?(en?'Return to greenery':'Вернуть зелень'):(en?'Let the flowers bloom':'Раскрыть цветы')}><span className="bloom-dot">✳</span><span>{expanded?(en?'Return to greenery':'Вернуть зелень'):(en?'Touch to bloom':'Прикоснитесь — и всё расцветёт')}</span></button>
 <div className="hero-bottom"><span>{en?'SELECTED BY NATURE. CHOSEN BY YOU.':'СОЗДАНО ПРИРОДОЙ. ВЫБРАНО ВАМИ.'}</span><a href="#selection">{en?'SCROLL TO DISCOVER':'ВНИЗ, К ПРЕКРАСНОМУ'} <span>↓</span></a></div>
 </section>
}
