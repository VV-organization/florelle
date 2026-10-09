'use client';
import {loadCart} from '@/lib/cart-query';
import {accountSegment} from '@/lib/shop-domain';
import {createContext,useContext,useEffect,useState,useCallback,useRef} from 'react';
import {useRouter} from 'next/navigation';
import {QueryClient,QueryClientProvider,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '@/lib/api-client';
import {convert,unitPrice,itemPrice,type Currency,type Segment,type Listing} from '@/lib/catalog';
import type {Content,User,CartResponse,CartLine} from '@/lib/storefront-types';
export type {User,CartLine};
type Shop={quickOpen:boolean;setQuickOpen:(open:boolean)=>void;currency:Currency;setCurrency:(c:Currency)=>void;segment:Segment;setSegment:(s:Segment)=>void;en:boolean;setEn:(e:boolean)=>void;cart:CartLine[];cartData?:CartResponse;cartError:string;cartBusy:boolean;add:(p:Listing,n?:number)=>Promise<void>;update:(id:string,segment:Segment,n:number)=>Promise<void>;clear:()=>Promise<void>;has:(id:string)=>boolean;authReady:boolean;ready:boolean;notice:string;setNotice:(s:string)=>void;user:User|null;setUser:(u:User|null)=>void;refreshUser:()=>Promise<void>;t:(ru:string,en:string)=>string;content:Content;convert:(a:number,f:Currency,t:Currency)=>number;unitPrice:(p:Listing,s:Segment,c:Currency)=>number;itemPrice:(p:Listing,s:Segment,c:Currency)=>number};
const Context=createContext<Shop|null>(null);
export function ShopProvider({children,initialContent}:{children:React.ReactNode;initialContent:Content}){const[client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:1,staleTime:30_000},mutations:{retry:false}}}));return <QueryClientProvider client={client}><ShopState initialContent={initialContent}>{children}</ShopState></QueryClientProvider>}
function ShopState({children,initialContent}:{children:React.ReactNode;initialContent:Content}){
 const router=useRouter(),client=useQueryClient();
 const[quickOpen,setQuickOpen]=useState(false);
 const[currency,setCurrency]=useState<Currency>('RUB'),[selectedSegment,setSelectedSegment]=useState<Segment>('b2c'),[en,setEn]=useState(false),[ready,setReady]=useState(false),[notice,setNotice]=useState(''),[user,setCurrentUser]=useState<User|null>(null),[cartError,setCartError]=useState(''),[cartBusy,setCartBusy]=useState(false);const mutation=useRef(false);
 const segment=accountSegment(user)??selectedSegment;
 const contentQuery=useQuery({queryKey:['content',currency,en,segment],queryFn:()=>api.request<Content>(`/storefront/content?currency=RUB&lang=${en?'en':'ru'}&segment=${segment}`),initialData:currency==='RUB'&&!en&&segment==='b2c'?initialContent:undefined});
 const content=contentQuery.data||initialContent;
 const setUser=useCallback((u:User|null)=>{setCurrentUser(u?{...u,phone:u.phone||'',company:u.company||''}:null);if(u)setSelectedSegment(accountSegment(u)!);else{api.setToken(null);client.removeQueries({queryKey:['cart']});client.removeQueries({queryKey:['orders']});}},[client]);
 const refreshUser=useCallback(async()=>{setUser(await api.request<User>('/auth/me'));},[setUser]);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('florelle-preferences')||'{}');if(['RUB','KZT','TRY'].includes(saved.currency))setCurrency(saved.currency);if(['b2b','b2c'].includes(saved.segment))setSelectedSegment(saved.segment);setEn(saved.en===true);localStorage.removeItem('flower-point-v1')}catch{}let active=true;api.restore().then(async restored=>{if(restored){const u=await api.request<User>('/auth/me');if(active)setUser(u)}}).catch(error=>{if(active)setCartError(error.message)}).finally(()=>{if(active)setReady(true)});return()=>{active=false}},[setUser]);
 useEffect(()=>{if(ready)try{localStorage.setItem('florelle-preferences',JSON.stringify({currency,segment,en}))}catch{}document.documentElement.lang=en?'en':'ru'},[currency,segment,en,ready]);
 const setSegment=useCallback((value:Segment)=>{const bound=accountSegment(user);if(bound&&bound!==value)return;setSelectedSegment(value)},[user]);
 const cartQuery=useQuery({queryKey:['cart',user?.id,currency,en],queryFn:()=>loadCart(()=>api.request<CartResponse>(`/cart?currency=${currency}&lang=${en?'en':'ru'}`),currency),enabled:ready&&!!user});
 const cart:CartLine[]=(cartQuery.data?.items||[]).map(l=>{const listing=l.listing;const seg=listing.unit==='box'?'b2b':listing.unit==='stem'?'b2c':segment;return {id:listing.id,itemId:l.id,segment:seg,quantity:l.quantity,lineTotal:Number(l.lineTotal),p:{id:listing.id,product:{...listing.product,description:'',image_url:listing.product.imageUrl,category_id:''},seller:listing.seller,seller_price:String(convert(Number(listing.sellerPrice),currency,'RUB',content.rates)),box_quantity:listing.boxQuantity,available_units:seg==='b2c'?listing.availableStock:0,image:listing.image,photo:listing.photo,wholesale:seg==='b2b'?{seller_price:String(convert(Number(listing.sellerPrice),currency,'RUB',content.rates)),ams_price:listing.amsPrice,available_units:listing.availableStock}:null}}});
 async function mutate(operation:()=>Promise<unknown>){if(mutation.current)return;mutation.current=true;setCartBusy(true);setCartError('');try{await operation();await client.invalidateQueries({queryKey:['cart']});await client.invalidateQueries({queryKey:['quote']});}catch(error){setCartError(error instanceof Error?error.message:'Request failed');if(error instanceof ApiError&&error.status===401)setUser(null);throw error;}finally{mutation.current=false;setCartBusy(false)}}
 async function add(p:Listing,n=1){if(!user){router.push('/account?return='+encodeURIComponent(location.pathname+location.search));return;}try{await mutate(()=>api.request('/cart/items',{method:'POST',body:JSON.stringify({listingId:p.id,quantity:n,segment})}));setNotice(p.product.name)}catch{}}
 async function update(id:string,seg:Segment,n:number){const line=cart.find(x=>x.id===id&&x.segment===seg);if(!line)return;try{await mutate(()=>api.request('/cart/items/'+line.itemId,{method:n<=0?'DELETE':'PATCH',...(n>0?{body:JSON.stringify({quantity:n,segment:seg})}:{})}))}catch{}}
 async function clear(){await client.invalidateQueries({queryKey:['cart']})}
 const value:Shop={quickOpen,setQuickOpen,currency,setCurrency,segment,setSegment,en,setEn,cart,cartData:cartQuery.data,cartError:cartError||cartQuery.error?.message||'',cartBusy,add,update,clear,has:id=>cart.some(x=>x.id===id&&x.segment===segment),authReady:ready,ready:ready&&(!user||!cartQuery.isPending),notice,setNotice,user,setUser,refreshUser,t:(ru,enText)=>en?enText:ru,content,convert:(amount,from,to)=>convert(amount,from,to,content.rates),unitPrice:(p,s,c)=>unitPrice(p,s,c,content.rates),itemPrice:(p,s,c)=>itemPrice(p,s,c,content.rates)};
 return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useShop(){const c=useContext(Context);if(!c)throw Error('Missing shop provider');return c}
