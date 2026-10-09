'use client';
import MotionText from '@/components/motion-text';

import Link from 'next/link';
import Image from 'next/image';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {canVisitSegment,segmentRedirect} from '@/lib/shop-domain';
import {routePath} from '@/lib/site-path';
import {Suspense,useEffect,useState} from 'react';
import {ShoppingBag,User,MagnifyingGlass,List,X,ArrowUpRight,ArrowUp} from '@phosphor-icons/react';
import {useShop} from './shop-context';
import {symbols,type Currency} from '@/lib/catalog';
import BrandLogo from './brand-logo';
import {Notice} from './products';
function StorefrontLoading(){const s=useShop();return <main className="page-shell" aria-busy="true"><p role="status">{s.t('Загрузка…','Loading…')}</p></main>}
export default function Storefront({children}:{children:React.ReactNode}){
 return <Suspense fallback={<StorefrontLoading/>}><StorefrontContent>{children}</StorefrontContent></Suspense>;
}
function StorefrontContent({children}:{children:React.ReactNode}){
 const s=useShop(),router=useRouter(),path=routePath(usePathname()),search=useSearchParams().toString();
 const[menu,setMenu]=useState(false);
 const redirect=s.authReady?segmentRedirect(s.user,path,search):null;
 useEffect(()=>{window.scrollTo({top:0,left:0,behavior:'instant'});setMenu(false)},[path]);
 useEffect(()=>{if(redirect)router.replace(redirect+window.location.hash,{scroll:false})},[redirect,router]);
 useEffect(()=>{
  if(!s.authReady||s.user)return;
  const requested=path==='/b2b'?'b2b':path==='/b2c'?'b2c':new URLSearchParams(search).get('segment');
  if(requested==='b2b'||requested==='b2c')s.setSegment(requested);
 },[path,search,s.authReady,s.user,s.setSegment]);
 if(!s.authReady||redirect)return <StorefrontLoading/>;
 if(path==='/')return <>{children}</>;
 return <><a href="#main-content" className="skip-link">{s.t('К содержимому','Skip to content')}</a><header className="header"><Link className="brand" href={'/'+s.segment} aria-label={s.t('Bloom-send — главная','Bloom-send — home')}><BrandLogo en={s.en}/></Link><nav aria-label={s.t('Основная навигация','Main navigation')}><Link className={path==='/catalog'?'active':''} href="/catalog">{s.t('Цветы','Flowers')}</Link><Link className={path==='/delivery'?'active':''} href="/delivery">{s.t('Доставка','Delivery')}</Link>{!s.user&&<Link href="/">{s.t('Розница / Опт','Retail / Wholesale')}</Link>}</nav><div className="header-actions"><label className="currency-select"><span className="sr-only">{s.t('Валюта','Currency')}</span><select aria-label={s.t('Валюта','Currency')} value={s.currency} onChange={e=>s.setCurrency(e.target.value as Currency)}>{(['RUB','KZT','TRY'] as Currency[]).map(c=><option key={c} value={c}>{c} {symbols[c]}</option>)}</select></label><button className="language-toggle" aria-label={s.en?'Switch to Russian':'Switch to English'} onClick={()=>s.setEn(!s.en)}>{s.en?'EN':'RU'}</button><Link className="header-search icon-button" href="/catalog" aria-label={s.t('Поиск','Search')}><MagnifyingGlass size={20}/></Link><Link className="header-account icon-button" href="/account" aria-label={s.t('Личный кабинет','Account')}><User size={20}/></Link><Link className="header-cart" href="/cart" aria-label={s.t('Корзина','Cart')+' ('+s.cart.length+')'}><ShoppingBag size={21}/><span className="cart-count">{s.cart.length.toString().padStart(2,'0')}</span></Link><button className="mobile-menu icon-button" aria-label={s.t('Меню','Menu')} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{menu?<X size={23}/>:<List size={23}/>}</button></div></header>{menu&&<nav className="mobile-navigation"><Link href="/catalog" onClick={()=>setMenu(false)}>{s.t('Коллекция цветов','Flower collection')}<ArrowUpRight/></Link><Link href="/delivery" onClick={()=>setMenu(false)}>{s.t('Доставка','Delivery')}<ArrowUpRight/></Link>{!s.user&&<Link href="/" onClick={()=>setMenu(false)}>{s.t('Розница / Опт','Retail / Wholesale')}<ArrowUpRight/></Link>}<Link href="/account" onClick={()=>setMenu(false)}>{s.t('Личный кабинет','Account')}<ArrowUpRight/></Link></nav>}<div id="main-content">{s.cartError&&<p role="alert" className="error-message">{s.cartError}</p>}{children}</div><footer className="footer"><div className="footer-top"><div><span className="eyebrow">{s.t('ПУСТЬ В ЖИЗНИ БУДЕТ БОЛЬШЕ','MAKE ROOM FOR SOMETHING')}</span><MotionText as="h2"><span className="script">{s.t('прекрасного','beautiful')}</span>.</MotionText></div><Link className="footer-cta" href="/catalog" aria-label={s.t('Перейти в каталог','Explore flowers')}><ArrowUpRight size={40} weight="thin"/></Link></div><div className="footer-main"><Link className="footer-wordmark" href={'/'+s.segment} aria-label={s.t('Bloom-send — главная','Bloom-send — home')}><BrandLogo en={s.en}/></Link><div className="footer-links"><MotionText as="p">{s.t('Цветы от природы.\nЧувства — от вас.','Flowers from nature.\nFeelings from you.')}</MotionText><div><Link href="/catalog">{s.t('Коллекция','Collection')}</Link><Link href="/delivery">{s.t('Доставка','Delivery')}</Link></div><div><Link href="/account">{s.t('Личный кабинет','Account')}</Link><Link href="/cart">{s.t('Корзина','Cart')}</Link><Link href="/orders">{s.t('Мои заказы','My orders')}</Link></div><div>{canVisitSegment(s.user,'b2b')&&<Link href="/catalog?segment=b2b" onClick={()=>s.setSegment('b2b')}>{s.t('Для бизнеса','Wholesale')}</Link>}<button onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>{s.t('Наверх','Back to top')}<ArrowUp size={16}/></button></div></div></div><div className="footer-bottom"><span>© 2026 BLOOM-SEND</span><Link href="/privacy">{s.t('Политика конфиденциальности','Privacy Policy')}</Link><Link href="/terms">{s.t('Пользовательское соглашение','User Agreement')}</Link><a href="mailto:support@bloom-send.com">support@bloom-send.com</a><span>RUB · KZT · TRY</span><div className="footer-payment-logos" aria-label={s.t('Платёжные системы','Payment systems')}><span><Image src="/payment/sbp-logo.svg" alt="СБП" width={23} height={28}/></span><span><Image src="/payment/mir-logo.svg" alt="Мир" width={93} height={28}/></span></div></div></footer><Notice/></>
}
