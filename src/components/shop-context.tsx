'use client';
import {createContext,useContext,useEffect,useState,useCallback,useRef} from 'react';
import {listings,available,type Currency,type Segment,type Listing} from '@/lib/catalog';
export type CartLine={id:string;segment:Segment;quantity:number};
export type User={id:string;name:string;email:string;phone:string;company:string};
type Shop={currency:Currency;setCurrency:(c:Currency)=>void;segment:Segment;setSegment:(s:Segment)=>void;en:boolean;setEn:(e:boolean)=>void;cart:CartLine[];add:(p:Listing,n?:number)=>void;update:(id:string,segment:Segment,n:number)=>void;clear:()=>void;has:(id:string)=>boolean;ready:boolean;notice:string;setNotice:(s:string)=>void;user:User|null;setUser:(u:User|null)=>void;refreshUser:()=>Promise<void>;t:(ru:string,en:string)=>string};
const Context=createContext<Shop|null>(null);
export function ShopProvider({children}:{children:React.ReactNode}){
 const[currency,setCurrency]=useState<Currency>('RUB'),[segment,setSegment]=useState<Segment>('b2c'),[en,setEn]=useState(false),[cart,setCart]=useState<CartLine[]>([]),[ready,setReady]=useState(false),[notice,setNotice]=useState(''),[user,setUser]=useState<User|null>(null);const cartRef=useRef(cart);cartRef.current=cart;
 const refreshUser=useCallback(async()=>{try{const r=await fetch('/api/account');if(r.ok){const d=await r.json();setUser(d.user)}}catch{}},[]);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('flower-point-v1')||'{}');if(['RUB','KZT','TRY'].includes(saved.currency))setCurrency(saved.currency);if(['b2b','b2c'].includes(saved.segment))setSegment(saved.segment);setEn(saved.en===true);if(Array.isArray(saved.cart)){const seen=new Set<string>();setCart(saved.cart.filter((l:CartLine)=>{const p=listings.find(x=>x.id===l.id),key=l.id+l.segment;if(!p||!['b2b','b2c'].includes(l.segment)||!Number.isInteger(l.quantity)||l.quantity<1||seen.has(key))return false;seen.add(key);return true}).map((l:CartLine)=>({...l,quantity:Math.min(l.quantity,available(listings.find(x=>x.id===l.id)!,l.segment))})).filter((l:CartLine)=>l.quantity>0))}}catch{}setReady(true);refreshUser()},[refreshUser]);
 useEffect(()=>{if(ready)try{localStorage.setItem('flower-point-v1',JSON.stringify({currency,segment,en,cart}))}catch{}document.documentElement.lang=en?'en':'ru'},[currency,segment,en,cart,ready]);
 function add(p:Listing,n=1){if(cartRef.current.some(x=>x.id===p.id&&x.segment===segment))return;const quantity=Math.min(Math.max(1,Math.floor(n)),available(p,segment));if(quantity<1)return;const next=[...cartRef.current,{id:p.id,segment,quantity}];cartRef.current=next;setCart(next);setNotice(p.product.name)}
 function update(id:string,s:Segment,n:number){setCart(current=>current.flatMap(l=>l.id===id&&l.segment===s?(n<=0?[]:[{...l,quantity:Math.min(Math.max(1,Math.floor(n)),available(listings.find(x=>x.id===id)!,s))}]):[l]))}
 function clear(){cartRef.current=[];setCart([])}
 const value={currency,setCurrency,segment,setSegment,en,setEn,cart,add,update,clear,has:(id:string)=>cart.some(x=>x.id===id&&x.segment===segment),ready,notice,setNotice,user,setUser,refreshUser,t:(ru:string,enText:string)=>en?enText:ru};
 return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useShop(){const c=useContext(Context);if(!c)throw Error('Missing shop provider');return c}
