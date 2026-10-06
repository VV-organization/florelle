'use client';
import MotionText from '@/components/motion-text';


import Link from 'next/link';
import BrandLogo from './brand-logo';
import {useRef,type MouseEvent} from 'react';
import {useEntryTransition} from './entry-transition';
import {ArrowUpRight} from '@phosphor-icons/react';
import {useShop} from './shop-context';

export default function EntryGateway() {
  const shop = useShop();
  const ref=useRef<HTMLElement>(null);
  const transition=useEntryTransition();
  function enter(event:MouseEvent<HTMLAnchorElement>,segment:'b2b'|'b2c'){
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
    event.preventDefault();shop.setSegment(segment);
    if(ref.current)transition('/'+segment,ref.current);
  }
  return (
    <main className="entry-gateway" ref={ref}>
      <header className="entry-header">
        <span className="brand"><BrandLogo en={shop.en}/></span>
        <button className="language-toggle" onClick={() => shop.setEn(!shop.en)} aria-label={shop.en ? 'Switch to Russian' : 'Switch to English'}>{shop.en ? 'EN' : 'RU'}</button>
      </header>
      <div className="entry-content">

        <MotionText as="h1">{shop.t('Ваш мир', 'Your world of')} <span className="script">{shop.t('цветов', 'flowers')}</span></MotionText>
        <MotionText as="p">{shop.t('Выберите, как вы покупаете', 'Choose your shopping experience')}</MotionText>
        <nav className="entry-options" aria-label={shop.t('Выбор формата покупки', 'Choose how to shop')}>
          <Link href="/b2b" className="entry-option" onClick={e=>enter(e,'b2b')}><span className="entry-frame" data-motion-frame="" aria-hidden="true"><i/><i/><i/><i/></span>
            <span className="eyebrow">{shop.t('ФЛОРИСТАМ, СТУДИЯМ И МАГАЗИНАМ', 'FOR FLORISTS, STUDIOS & SHOPS')}</span>
            <MotionText as="h2">{shop.t('Для', 'For')} <span className="script">{shop.t('бизнеса', 'business')}</span></MotionText>
            <MotionText as="p">{shop.t('Оптовые цены, заказ коробками и ориентир AMS.', 'Wholesale pricing, by the box, AMS reference.')}</MotionText>
            <span className="entry-action">{shop.t('Перейти в опт', 'Enter wholesale')}<ArrowUpRight size={25}/></span>
          </Link>
          <Link href="/b2c" className="entry-option" onClick={e=>enter(e,'b2c')}><span className="entry-frame" data-motion-frame="" aria-hidden="true"><i/><i/><i/><i/></span>
            <span className="eyebrow">{shop.t('ДЛЯ СЕБЯ И БЛИЗКИХ', 'FOR YOU & YOUR LOVED ONES')}</span>
            <MotionText as="h2">{shop.t('Для', 'For')} <span className="script">{shop.t('себя', 'you')}</span></MotionText>
            <MotionText as="p">{shop.t('Розничные цены, цветы поштучно для вашего события.', 'Retail pricing, per stem, ready for your event.')}</MotionText>
            <span className="entry-action">{shop.t('Перейти в розницу', 'Enter retail')}<ArrowUpRight size={25}/></span>
          </Link>
        </nav>
      </div>
    </main>
  );
}
