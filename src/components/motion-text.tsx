'use client';

import {useRef,useLayoutEffect,Children,cloneElement,isValidElement,type ReactNode,type ReactElement,type HTMLAttributes} from 'react';

type Tag='h1'|'h2'|'h3'|'h4'|'h5'|'p';
function plain(children:ReactNode):string {return Children.toArray(children).map(child=>typeof child==='string'||typeof child==='number'?String(child):isValidElement(child)?((child.props as {children?:ReactNode;'aria-hidden'?:boolean})['aria-hidden']?'':plain((child.props as {children?:ReactNode}).children)):'').join('')}
function split(children:ReactNode,paragraph:boolean):ReactNode {
 return Children.map(children,child=>{
  if(typeof child==='string'||typeof child==='number')return String(child).split(/(\s+)/).map((word,i)=>/\S/.test(word)?
   <span className={paragraph?'motion-word-mask':'motion-word'} key={i} aria-hidden={paragraph?undefined:true}>{paragraph?<span className="motion-line-word">{word}</span>:Array.from(word).map((char,j)=><span className="motion-char" key={j}>{char}</span>)}</span>:word);
  if(!isValidElement(child))return child;
  const el=child as ReactElement<HTMLAttributes<HTMLElement>&{children?:ReactNode}>;
  if(/\b(script|handwritten)\b/.test(el.props.className||''))return cloneElement(el,{'data-motion-ink':'','aria-hidden':paragraph?undefined:true} as HTMLAttributes<HTMLElement>);
  return typeof el.type==='string'&&el.props.children?cloneElement(el,{},split(el.props.children,paragraph)):el;
 });
}
export default function MotionText({as:Tag='h2',children,singleLine=true,...props}:HTMLAttributes<HTMLElement>&{as?:Tag;children?:ReactNode;singleLine?:boolean}){
 const line=useRef<HTMLSpanElement>(null),single=Tag!=='p'&&singleLine;
 useLayoutEffect(()=>{
  const content=line.current,heading=content?.parentElement;if(!content||!heading)return;
  let disposed=false;
  const fit=()=>{
   if(disposed)return;
   heading.style.removeProperty('font-size');
   const base=parseFloat(getComputedStyle(heading).fontSize),available=heading.clientWidth;
   if(!available)return;
   // Layout widths ignore the letter entrance transforms and keep the fit stable.
   const width=content.offsetWidth;
   if(width>available)heading.style.fontSize=`${base*(available/width)*.97}px`;
  };
  const observer=new ResizeObserver(fit);observer.observe(heading);
  document.fonts.ready.then(fit);window.addEventListener('resize',fit);fit();
  return()=>{disposed=true;observer.disconnect();window.removeEventListener('resize',fit)};
 },[children,single]);
 const text=split(children,Tag==='p');
 return <Tag {...props} className={[props.className,single?'single-line-heading':''].filter(Boolean).join(' ')} aria-label={props['aria-label']||(Tag!=='p'?plain(children):undefined)} data-motion-text={Tag==='p'?'lines':'heading'}>{single?<span ref={line} className="heading-line">{text}</span>:text}</Tag>;
}
