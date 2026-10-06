'use client';
import {useState} from 'react';
import Link from 'next/link';
import type {Listing} from '@/lib/catalog';
import Home from './home';
import CatalogView from './catalog-view';
import {ProductDetail,ProductCard,SellerOffers,QuickView} from './products';
import {useShop} from './shop-context';
import MotionText from './motion-text';
export function HomeScreen(){const[quick,setQuick]=useState<Listing|null>(null);return <><Home onQuick={setQuick}/><QuickView product={quick} onClose={()=>setQuick(null)}/></>}
export function CatalogScreen(){const[quick,setQuick]=useState<Listing|null>(null);return <><CatalogView onQuick={setQuick}/><QuickView product={quick} onClose={()=>setQuick(null)}/></>}
export function ProductScreen({product,offers,related}:{product:Listing;offers:Listing[];related:Listing[]}){const s=useShop(),[quick,setQuick]=useState<Listing|null>(null);return <><main className="product-page"><div className="breadcrumbs"><Link href="/catalog">{s.t('Коллекция','Collection')}</Link><span>/</span><span>{product.product.name}</span></div><ProductDetail key={product.id} p={product}/><SellerOffers p={product} offers={offers}/><section className="section related-products"><div className="section-heading"><MotionText as="h2">{s.t('Вам','You may')} <span className="script">{s.t('понравится','also love')}</span></MotionText></div><div className="product-grid home-products">{related.map((p,i)=><ProductCard p={p} key={p.id} index={i} onQuick={setQuick}/>)}</div></section></main><QuickView product={quick} onClose={()=>setQuick(null)}/></>}
