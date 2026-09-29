'use client';

import Link from 'next/link';
import {ArrowUpRight} from '@phosphor-icons/react';
import {useShop} from './shop-context';

export default function EntryGateway() {
  const shop = useShop();
  return (
    <main className="entry-gateway">
      <header className="entry-header">
        <span className="brand"><span className="brand-name">Florelle</span><small>{shop.t('ЦВЕТЫ ВМЕСТО СЛОВ', 'FLOWERS BEYOND WORDS')}</small></span>
        <button className="language-toggle" onClick={() => shop.setEn(!shop.en)} aria-label={shop.en ? 'Switch to Russian' : 'Switch to English'}>{shop.en ? 'EN' : 'RU'}</button>
      </header>
      <div className="entry-content">
        <span className="eyebrow">{shop.t('ДОБРО ПОЖАЛОВАТЬ В FLORELLE', 'WELCOME TO FLORELLE')}</span>
        <h1>{shop.t('Ваш мир', 'Your world of')} <span className="script">{shop.t('цветов', 'flowers')}</span></h1>
        <p>{shop.t('Выберите, как вы покупаете', 'Choose your shopping experience')}</p>
        <nav className="entry-options" aria-label={shop.t('Выбор формата покупки', 'Choose how to shop')}>
          <Link href="/b2b" className="entry-option" onClick={() => shop.setSegment('b2b')}>
            <span className="eyebrow">{shop.t('ФЛОРИСТАМ, СТУДИЯМ И МАГАЗИНАМ', 'FOR FLORISTS, STUDIOS & SHOPS')}</span>
            <h2>{shop.t('Для', 'For')} <span className="script">{shop.t('бизнеса', 'business')}</span></h2>
            <p>{shop.t('Оптовые цены, заказ коробками и ориентир AMS.', 'Wholesale pricing, by the box, AMS reference.')}</p>
            <span className="entry-action">{shop.t('Перейти в опт', 'Enter wholesale')}<ArrowUpRight size={25}/></span>
          </Link>
          <Link href="/b2c" className="entry-option" onClick={() => shop.setSegment('b2c')}>
            <span className="eyebrow">{shop.t('ДЛЯ СЕБЯ И БЛИЗКИХ', 'FOR YOU & YOUR LOVED ONES')}</span>
            <h2>{shop.t('Для', 'For')} <span className="script">{shop.t('себя', 'you')}</span></h2>
            <p>{shop.t('Розничные цены, цветы поштучно для вашего события.', 'Retail pricing, per stem, ready for your event.')}</p>
            <span className="entry-action">{shop.t('Перейти в розницу', 'Enter retail')}<ArrowUpRight size={25}/></span>
          </Link>
        </nav>
      </div>
    </main>
  );
}
