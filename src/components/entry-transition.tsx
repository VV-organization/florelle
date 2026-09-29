'use client';

import {createContext,useCallback,useContext,useEffect,useRef,type ReactNode} from 'react';
import {usePathname,useRouter} from 'next/navigation';

const EntryTransitionContext=createContext<(href:string,source:HTMLElement)=>void>(()=>{});
export const useEntryTransition=()=>useContext(EntryTransitionContext);

// Cubic Bézier curves measured from ERA's opening: InOut and diveIn.
function ease(t:number,x1:number,x2:number){
 const point=(u:number,a:number,b:number)=>3*(1-u)*(1-u)*u*a+3*(1-u)*u*u*b+u*u*u;
 let lo=0,hi=1;
 for(let i=0;i<18;i++){const m=(lo+hi)/2;if(point(m,x1,x2)<t)lo=m;else hi=m}
 return point((lo+hi)/2,0,1);
}

export default function EntryTransition({children}:{children:ReactNode}){
 const router=useRouter(),path=usePathname();
 const cover=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 const pending=useRef<string|null>(null),dispose=useRef<()=>void>(()=>{});
 const begin=useCallback((href:string,source:HTMLElement)=>{
  if(pending.current)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){router.push(href,{scroll:false});return}
  const el=cover.current;if(!el)return;
  pending.current=href;
  document.documentElement.dataset.entryRevealAt=String(performance.now()+1950);
  const snapshot=source.cloneNode(true) as HTMLElement;
  snapshot.inert=true;
  el.replaceChildren(snapshot);
  const contours=document.createElement('div');contours.className='entry-arch-contours';
  contours.innerHTML='<div></div><div></div>';el.append(contours);
  el.style.setProperty('--arch-w',window.innerWidth>=992?'24vw':'40vw');
  el.style.setProperty('--arch-y','104vh');el.hidden=false;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';if(content.current)content.current.inert=true;
  const fallback=window.setTimeout(()=>dispose.current(),10000);
  dispose.current=()=>{
   delete document.documentElement.dataset.entryRevealAt;
   clearTimeout(fallback);el.hidden=true;el.replaceChildren();pending.current=null;
   document.body.style.overflow=overflow;if(content.current)content.current.inert=false;
  };
  // The animated header is initially invisible: Next can otherwise skip it and scroll to the hero.
  router.push(href,{scroll:false});
 },[router]);
 useEffect(()=>{
  if(!pending.current)return;
  if(path!==pending.current){if(path!=='/')dispose.current();return}
  document.documentElement.dataset.entryRevealAt=String(performance.now()+1950);
  const el=cover.current!;
  const desktop=window.innerWidth>=992,startWidth=desktop?24:40,midWidth=desktop?36:50;
  const startSecond=ease(.9,.75,.25),secondW=startWidth+(midWidth-startWidth)*startSecond,secondY=104-89*startSecond;
  let raf=0,start=0,cancelled=false;
  const animations:Animation[]=[];
  const clean=dispose.current;
  dispose.current=()=>{cancelled=true;cancelAnimationFrame(raf);animations.forEach(a=>a.cancel());clean()};
  const animate=(now:number)=>{
   if(cancelled)return;
   if(!start){start=now;
    window.scrollTo({top:0,left:0,behavior:'instant'});
    // Full-bleed botanical layers must cover the viewport throughout the zoom.
    document.querySelectorAll('.hero .botanical,.hero .botanical-canvas').forEach(node=>animations.push(node.animate([{scale:'1.15'},{scale:'1'}],{delay:1350,duration:1500,easing:'cubic-bezier(.75,0,.25,1)',fill:'both'})));
   }
   const t=now-start;
   let w,y;
   if(t<1350){const p=ease(Math.min(t/1500,1),.75,.25);w=startWidth+(midWidth-startWidth)*p;y=104-89*p}
   else{const p=ease(Math.min((t-1350)/2400,1),.6,0);w=secondW+(125-secondW)*p;y=secondY+(-100-secondY)*p}
   el.style.setProperty('--arch-w',w+'vw');el.style.setProperty('--arch-y',y+'vh');
   if(t<3750)raf=requestAnimationFrame(animate);
   else{dispose.current();const heading=content.current?.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}window.scrollTo({top:0,left:0,behavior:'instant'})}
  };
  // The route is mounted before revealing it; two frames allow its first paint.
  raf=requestAnimationFrame(()=>{raf=requestAnimationFrame(animate)});
  return ()=>dispose.current();
 },[path]);
 useEffect(()=>()=>dispose.current(),[]);
 return <EntryTransitionContext.Provider value={begin}><div ref={content}>{children}</div><div ref={cover} className="entry-arch-transition" hidden aria-hidden="true"/></EntryTransitionContext.Provider>;
}
