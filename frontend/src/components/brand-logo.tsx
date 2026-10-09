'use client';
import {assetPath} from '@/lib/site-path';
import {useEffect,useRef} from 'react';

type BrandLogoProps = {en?:boolean; className?:string};

/** Only the circular inscription rotates; the floral centre remains still. */
export default function BrandLogo({en=false,className=''}:BrandLogoProps){
 const ring=useRef<HTMLImageElement>(null);
 useEffect(()=>{
  const el=ring.current;if(!el)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  // Animate the rendered transform without rewriting DOM style each frame.
  // Session recorders would otherwise collect thousands of irrelevant mutations.
  const rotation=el.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:12000,easing:'linear',fill:'both'});
  rotation.pause();rotation.currentTime=0;
  let frame=0,angle=0,speed=30,target=30,direction=1,last=0,lastScroll=performance.now(),lastY=window.scrollY,scrollUntil=0,interacted=false,visible=true;
  const input=()=>{interacted=true};
  const scroll=()=>{
   const now=performance.now(),y=window.scrollY,delta=y-lastY;
   const velocity=delta/Math.max(16.67,now-lastScroll)*16.67;
   lastY=y;lastScroll=now;
   if(!interacted||!delta)return;
   direction=delta>0?1:-1;target=direction*(30+10*Math.abs(velocity));scrollUntil=now+100;
  };
  const tick=(now:number)=>{
   const dt=Math.min(now-last,100);last=now;
   if(now>scrollUntil)target=30*direction;
   speed+=(target-speed)*(1-Math.exp(-dt/(now>scrollUntil?400:100)));
   angle=(angle+speed*dt/1000)%360;
   rotation.currentTime=((angle+360)%360)/360*12000;
   frame=requestAnimationFrame(tick);
  };
  const update=()=>{
   cancelAnimationFrame(frame);
   if(reduced.matches){angle=0;rotation.currentTime=0;return}
   if(visible&&!document.hidden){last=performance.now();frame=requestAnimationFrame(tick)}
  };
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()});observer.observe(el);
  window.addEventListener('wheel',input,{passive:true});window.addEventListener('touchmove',input,{passive:true});window.addEventListener('scroll',scroll,{passive:true});
  document.addEventListener('visibilitychange',update);reduced.addEventListener('change',update);update();
  return()=>{cancelAnimationFrame(frame);rotation.cancel();observer.disconnect();window.removeEventListener('wheel',input);window.removeEventListener('touchmove',input);window.removeEventListener('scroll',scroll);document.removeEventListener('visibilitychange',update);reduced.removeEventListener('change',update)};
 },[]);
 return <span className={`florelle-logo ${className}`} role="img" aria-label={en?'Bloom-send — flower atelier':'Bloom-send — цветочное ателье'}>
  <img ref={ring} className="florelle-logo__seal" src={assetPath(`/brand/florelle-ring-${en?'en':'ru'}-cream.svg`)} width="120" height="120" alt="" aria-hidden="true"/>
  <img className="florelle-logo__flower" src={assetPath('/brand/florelle-flower-centered.svg')} width="120" height="120" alt="" aria-hidden="true"/>
 </span>
}
