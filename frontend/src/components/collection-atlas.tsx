'use client';
import FlowerPhoto from './flower-photo';

import {useState} from 'react';
import Link from 'next/link';
import MotionText from './motion-text';
import {useShop} from './shop-context';

const flowers = [
 {slug:'rose-1',ru:'Розы',en:'Roses',image:'/catalog/cutouts/2779.webp',note:['Нежность в каждом лепестке','Tenderness in every petal'],copy:['От воздушных пудровых до глубоких винных оттенков. Найдите розу для своего признания.','From powdery pastels to deep wine shades. Find a rose that speaks for you.']},
 {slug:'peonies-25',ru:'Пионы',en:'Peonies',image:'/catalog/cutouts/28261.webp',note:['Мгновение расцвета','A moment in bloom'],copy:['Объёмные бутоны и невесомые лепестки. Для встреч, которые хочется запомнить.','Generous buds and weightless petals. For moments you want to remember.']},
 {slug:'hydrangea-24',ru:'Гортензии',en:'Hydrangeas',image:'/catalog/cutouts/28946.webp',note:['Целое облако чувств','A cloud of feeling'],copy:['Множество маленьких цветов в одном соцветии. Нежный акцент или основа пышкого букета.','A multitude of little flowers in a single head. A delicate accent or the heart of a generous bouquet.']},
];

export default function CollectionAtlas(){
 const s=useShop();const [active,setActive]=useState(0);const chosen=flowers[active];
 return <section className="collection-section section">
  <div className="section-heading"><MotionText as="h2">{s.t('Всё начинается','It all starts')}{' '}<span className="script">{s.t('с одного цветка','with one flower')}</span></MotionText><Link className="text-link" href="/catalog">{s.t('Найти свой','Find yours')}</Link></div>
  <nav className="curated-collections" aria-label={s.t('Подборки цветов','Curated collections')}>{[['premium-roses','Премиальные розы','Premium roses'],['spring-collection','Летняя коллекция','Summer collection']].map(([slug,ru,en])=><Link key={slug} href={'/catalog?collection='+slug}>{s.t(ru,en)}</Link>)}</nav><div className="collection-atlas">
   <div className="atlas-art" aria-hidden="true">
    <div className="atlas-plane"/>
    <div className="atlas-outline"/>
    <div className="atlas-specimens">{flowers.map((flower,i)=><div key={flower.slug} className={'atlas-specimen'+(i===active?' is-active':'')}><FlowerPhoto src={flower.image} alt="" width="750" height="850" loading="lazy"/></div>)}</div>
    <div className="atlas-detail">{flowers.map((flower,i)=><FlowerPhoto key={flower.slug} sizes="30vw" className={i===active?'is-active':''} src={flower.image} alt="" width="750" height="850" loading="lazy"/>)}</div>
    <span className="atlas-hand script" key={chosen.slug}>{s.t(chosen.note[0],chosen.note[1])}</span>
   </div>
   <div className="atlas-index">
    <nav aria-label={s.t('Коллекции цветов','Flower collections')} className="atlas-navigation">{flowers.map((flower,i)=><Link key={flower.slug} href={'/catalog?category='+flower.slug} className={'atlas-choice'+(i===active?' is-active':'')} onPointerEnter={event=>{if(event.pointerType==='mouse')setActive(i)}} onFocus={()=>setActive(i)}>
     <span className="atlas-thumb"><FlowerPhoto src={flower.image} alt="" sizes="100px" width="100" height="120" loading="lazy"/></span><MotionText as="h3">{s.t(flower.ru,flower.en)}</MotionText><span className="atlas-open">{s.t('Смотреть','Explore')}</span>
    </Link>)}</nav>
    <div className="atlas-description" key={chosen.slug}><MotionText as="p">{s.t(chosen.copy[0],chosen.copy[1])}</MotionText></div>
    <Link className="atlas-all text-link" href="/catalog">{s.t('Все цветы коллекции','All flowers in the collection')}</Link>
   </div>
  </div>
 </section>;
}
