'use client';
import {collectionLabel} from '@/lib/collection-label';
import FlowerPhoto from './flower-photo';

import {useState} from 'react';
import Link from 'next/link';
import MotionText from './motion-text';
import {useShop} from './shop-context';

const flowers = [
 {slug:'rose-1',ru:'Розы',en:'Roses',image:'/catalog/cutouts/2779.webp',copy:['Широкая цветовая гамма: от светлых до тёмно-красных. Выберите розу по цвету, длине стебля и цене.','A wide colour range, from light shades to deep red. Choose roses by colour, stem length and price.']},
 {slug:'peonies-25',ru:'Пионы',en:'Peonies',image:'/catalog/cutouts/28261.webp',copy:['Крупные махровые бутоны. Выберите пионы по цвету, размеру бутона и цене.','Large, double blooms. Choose peonies by colour, bud size and price.']},
 {slug:'hydrangea-24',ru:'Гортензии',en:'Hydrangeas',image:'/catalog/cutouts/28946.webp',copy:['Крупное соцветие из множества мелких цветов. Выберите гортензии по цвету, размеру соцветия и цене.','Large flower heads made up of many small flowers. Choose hydrangeas by colour, head size and price.']},
];

export default function CollectionAtlas(){
 const s=useShop();const [active,setActive]=useState(0);const chosen=flowers[active];
 return <section className="collection-section section">
  <div className="section-heading"><MotionText as="h2" singleLine={false}>{s.t('Ассортимент по категориям','Browse by category')}</MotionText><Link className="text-link" href="/catalog">{s.t('Весь каталог','Full catalogue')}</Link></div>
  <nav className="curated-collections" aria-label={s.t('Подборки цветов','Curated collections')}>{['premium-roses','spring-collection'].map((slug)=><Link key={slug} href={'/catalog?collection='+slug}>{collectionLabel(slug,s.en,slug)}</Link>)}</nav><div className="collection-atlas">
   <div className="atlas-art" aria-hidden="true">
    <div className="atlas-plane"/>
    <div className="atlas-outline"/>
    <div className="atlas-specimens">{flowers.map((flower,i)=><div key={flower.slug} className={'atlas-specimen'+(i===active?' is-active':'')}><FlowerPhoto src={flower.image} alt="" width="750" height="850" loading="lazy"/></div>)}</div>
    <div className="atlas-detail">{flowers.map((flower,i)=><FlowerPhoto key={flower.slug} sizes="30vw" className={i===active?'is-active':''} src={flower.image} alt="" width="750" height="850" loading="lazy"/>)}</div>

   </div>
   <div className="atlas-index">
    <nav aria-label={s.t('Коллекции цветов','Flower collections')} className="atlas-navigation">{flowers.map((flower,i)=><Link key={flower.slug} href={'/catalog?category='+flower.slug} className={'atlas-choice'+(i===active?' is-active':'')} onPointerEnter={event=>{if(event.pointerType==='mouse')setActive(i)}} onFocus={()=>setActive(i)}>
     <span className="atlas-thumb"><FlowerPhoto src={flower.image} alt="" sizes="100px" width="100" height="120" loading="lazy"/></span><MotionText as="h3">{s.t(flower.ru,flower.en)}</MotionText><span className="atlas-open">{s.t('Смотреть','Explore')}</span>
    </Link>)}</nav>
    <div className="atlas-description" key={chosen.slug}><MotionText as="p">{s.t(chosen.copy[0],chosen.copy[1])}</MotionText></div>
    <Link className="atlas-all text-link" href="/catalog">{s.t('Весь каталог','Full catalogue')}</Link>
   </div>
  </div>
 </section>;
}
