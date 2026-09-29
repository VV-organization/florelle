'use client';
import Link from 'next/link';
import {useEffect,useRef} from 'react';
import {ArrowUpRight} from '@phosphor-icons/react';
import {type Listing} from '@/lib/catalog';
import {useShop} from './shop-context';
import {ProductCard} from './products';

export default function FlowerGallery({products,onQuick}:{products:Listing[];onQuick:(p:Listing)=>void}){
 const shop=useShop(),section=useRef<HTMLElement>(null),viewport=useRef<HTMLDivElement>(null),track=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const root=section.current!,view=viewport.current!,rail=track.current!;
  const desktop=matchMedia('(min-width: 900px) and (min-height: 650px)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let distance=0,current=0,target=0,frame=0,enabled=false;
  const paint=()=>{frame=0;current+=(target-current)*.16;if(Math.abs(current-target)<.2)current=target;rail.style.transform=`translate3d(${-current}px,0,0)`;if(current!==target)frame=requestAnimationFrame(paint)};
  const scroll=()=>{if(!enabled)return;target=Math.max(0,Math.min(distance,-root.getBoundingClientRect().top));if(!frame)frame=requestAnimationFrame(paint)};
  const measure=()=>{
   enabled=desktop.matches&&!reduced.matches;
   root.dataset.pinned=String(enabled);
   distance=Math.max(0,rail.scrollWidth-view.clientWidth);
   root.style.height=enabled?`${innerHeight+distance}px`:'';
   if(enabled){view.scrollLeft=0;scroll()}else{cancelAnimationFrame(frame);frame=0;current=target=0;rail.style.transform=''}
  };
  const focus=(event:FocusEvent)=>{
   if(!enabled)return;
   const card=(event.target as HTMLElement).closest<HTMLElement>('.gallery-piece');if(!card)return;
   const desired=Math.max(0,Math.min(distance,card.offsetLeft-(view.clientWidth-card.offsetWidth)/2));
   const rect=card.getBoundingClientRect();
   if(rect.left<0||rect.right>view.clientWidth){window.scrollTo({top:scrollY+root.getBoundingClientRect().top+desired,behavior:'instant'});current=target=desired;rail.style.transform=`translate3d(${-desired}px,0,0)`}
  };
  const observer=new ResizeObserver(measure);observer.observe(view);observer.observe(rail);
  window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',measure);
  desktop.addEventListener('change',measure);reduced.addEventListener('change',measure);rail.addEventListener('focusin',focus);measure();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',scroll);window.removeEventListener('resize',measure);desktop.removeEventListener('change',measure);reduced.removeEventListener('change',measure);rail.removeEventListener('focusin',focus)};
 },[]);
 return <section ref={section} id="selection" className="flower-gallery" aria-label={shop.t('Избранные цветы','Selected flowers')}>
  <div className="flower-gallery-stage">
   <div className="section-heading gallery-heading"><span className="eyebrow">01 / {shop.t('ИЗБРАННОЕ ПРИРОДОЙ','NATURE’S FAVOURITES')}</span><h2>{shop.t('Выбирайте','Choose with')} <span className="script">{shop.t('чувствами','feeling')}</span></h2><Link className="text-link" href="/catalog">{shop.t('Вся коллекция','The full collection')}<ArrowUpRight size={19}/></Link></div>
   <div ref={viewport} className="flower-gallery-viewport"><div ref={track} className="flower-gallery-track">{products.map((p,i)=><div className={'gallery-piece gallery-piece--'+(['large','small','medium','large','small','medium','small','large'][i%8])} key={p.id}><ProductCard p={p} onQuick={onQuick} index={i}/></div>)}</div></div>
  </div>
 </section>;
}
