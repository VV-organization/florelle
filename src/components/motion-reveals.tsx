'use client';

import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';

const OUT='cubic-bezier(.25,1,.5,1)',IN_OUT='cubic-bezier(.75,0,.25,1)';
const MEDIA='.product-photo > a,.detail-image,.delivery-visual,.atlas-art,.auth-art';
const DETAILS='.atlas-choice,.atlas-description,.photo-top,.segment-control,.collection-tabs,.country-tabs,.pagination,.breadcrumbs,.delivery-promises > *, .delivery-estimate,.table-scroll,.cart-summary,.checkout-summary,.footer-cta,.mobile-navigation > a,.icon-button,.eyebrow,.product-meta,.product-title,.price,.detail-price,.detail-copy dl > div,.detail-delivery,.payment-marks,.country-line,.care-strip > div,.faq-list details,.footer-bottom,.footer-links > *,label,.filter-group,.catalog-toolbar,.cart-item,.order-card,.entry-action,.hero-topline > span,.hero-bottom > *,header nav > a,.header-actions > *, .language-toggle,.florelle-logo,.button,.text-link,.bloom-hint';
const SELECTOR=`[data-motion-frame],[data-motion-text],${MEDIA},${DETAILS}`;
type Entrance={animations:Animation[];started:boolean};

/** ERA's entrances, observed in either scroll axis. All DOM text belongs to React. */
export default function MotionReveals({children}:{children:ReactNode}){
 const root=useRef<HTMLDivElement>(null),path=usePathname();
 useLayoutEffect(()=>{
  const scope=root.current!;const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const frames=new WeakMap<Animation,Keyframe[]>();
  const entries=new Map<HTMLElement,Entrance>();const seen=new WeakSet<HTMLElement>();let scanFrame=0;
  const stop=(el:HTMLElement)=>{const entry=entries.get(el);if(!entry)return;entry.animations.forEach(a=>a.cancel());entries.delete(el);observer.unobserve(el)};
  const play=(el:HTMLElement)=>{
   const entry=entries.get(el);if(!entry||entry.started)return;entry.started=true;observer.unobserve(el);
   const archAt=Number(document.documentElement.dataset.entryRevealAt||0);
   const wait=el.closest('.hero,.header')?Math.max(0,archAt-performance.now()):0;
   entry.animations.forEach(a=>{(a.effect as KeyframeEffect).setKeyframes(frames.get(a)!);const timing=a.effect?.getTiming();a.effect?.updateTiming({delay:Number(timing?.delay||0)+wait});a.play()});
   Promise.allSettled(entry.animations.map(a=>a.finished)).then(()=>{if(entries.get(el)===entry)stop(el)});
  };
  const observer=new IntersectionObserver(changes=>changes.forEach(e=>{if(e.isIntersecting)play(e.target as HTMLElement)}),{threshold:0});
  function register(el:HTMLElement){
   if(seen.has(el)||el.closest('.entry-arch-transition,.cart-notice,[aria-live],.quantity')||el.closest('[hidden]'))return;
   // Animate a control group once, without compounding transforms on its children.
   if(!el.matches('[data-motion-text]')&&el.parentElement?.closest('[data-motion-text],label,.cart-item,.order-card,.catalog-toolbar,.care-strip > div'))return;
   seen.add(el);if(reduced.matches)return;
   const animations:Animation[]=[];
   const add=(target:Element,keyframes:Keyframe[],delay=0,easing=OUT,duration=1200)=>{
    // A zero-area clip would prevent IntersectionObserver from ever seeing the target.
    const initial=keyframes.map(frame=>({...frame,...(frame.clipPath?{clipPath:'none',opacity:0}:frame.maskImage?{maskImage:'none',opacity:0}:{})}));
    const a=target.animate(initial,{duration,delay,fill:'both',easing});frames.set(a,keyframes);a.pause();a.currentTime=0;animations.push(a);
   };
   if(el.hasAttribute('data-motion-frame')){
    const stagger=el.closest('.entry-option')?.previousElementSibling?150:0;
    Array.from(el.children).forEach((edge,i)=>{const axis=i%2?'Y':'X';add(edge,[{transform:`scale${axis}(0)`},{transform:`scale${axis}(1)`}],stagger+i*260,IN_OUT,650)});
   }else if(el.dataset.motionText==='heading'){
    el.querySelectorAll<HTMLElement>('.motion-char').forEach((char,i)=>add(char,[{opacity:0,transform:'translateY(50%) rotateY(90deg)'},{opacity:1,transform:'translateY(0) rotateY(0)'}],Math.min(i*50,700)));
    el.querySelectorAll<HTMLElement>('[data-motion-ink]').forEach(ink=>add(ink,[{clipPath:'inset(-50% 110% -60% -45%)'},{clipPath:'inset(-50% -65% -60% -45%)'}],350,IN_OUT,1400));
   }else if(el.dataset.motionText==='lines'){
    const words=Array.from(el.querySelectorAll<HTMLElement>('.motion-line-word'));const lines:number[]=[];
    words.forEach(word=>{const top=word.getBoundingClientRect().top;let line=lines.findIndex(y=>Math.abs(y-top)<3);if(line<0){line=lines.length;lines.push(top)}add(word,[{transform:'translateY(115%)'},{transform:'translateY(0)'}],line*100+100)});
   }else if(el.matches('.catalogue-grid .product-photo > a')){
    // Catalog browsing needs a quiet entrance, without a wipe or moving the flower.
    add(el,[{opacity:0},{opacity:1}],0,'ease-out',280);
   }else if(el.matches(MEDIA)){
    add(el,[{clipPath:'polygon(100% 0%,100% 0%,101% 100%,125% 100%)'},{clipPath:'polygon(0% 0%,100% 0%,100% 100%,0% 100%)'}],100,IN_OUT);
    const img=el.querySelector('img');if(img)add(img,[{scale:'1.5',translate:'25% 0'},{scale:'1',translate:'0 0'}],100,IN_OUT);
   }else{
    // ERA's line wipe for interface details; never rotate fields or alter their layout.
    // Masks preserve hit testing, so an appearing button accepts the first click.
    const mask={maskImage:'linear-gradient(to bottom,#000 50%,transparent 50%)',maskSize:'100% 200%',maskRepeat:'no-repeat'};
    add(el,[{...mask,maskPosition:'0 100%'},{...mask,maskPosition:'0 0%'}],100,OUT,900);
   }
   if(!animations.length)return;
   entries.set(el,{animations,started:false});observer.observe(el);
  }
  const scan=()=>{scanFrame=0;for(const el of entries.keys())if(!el.isConnected)stop(el);scope.querySelectorAll<HTMLElement>(SELECTOR).forEach(register)};
  const mutations=new MutationObserver(()=>{if(!scanFrame)scanFrame=requestAnimationFrame(scan)});
  scan();mutations.observe(scope,{childList:true,subtree:true});
  const focus=(e:Event)=>{const target=e.target as HTMLElement;for(const el of entries.keys())if(el.contains(target)||target.contains(el))stop(el)};
  const finish=()=>{for(const el of entries.keys())stop(el)};
  const preference=()=>{if(reduced.matches)finish()};
  const visibility=()=>{if(document.hidden)finish()};
  scope.addEventListener('focusin',focus);scope.addEventListener('pointerdown',focus,true);reduced.addEventListener('change',preference);document.addEventListener('visibilitychange',visibility);
  return()=>{cancelAnimationFrame(scanFrame);mutations.disconnect();observer.disconnect();finish();scope.removeEventListener('focusin',focus);scope.removeEventListener('pointerdown',focus,true);reduced.removeEventListener('change',preference);document.removeEventListener('visibilitychange',visibility)};
 },[path]);
 return <div ref={root} className="motion-root">{children}</div>;
}
