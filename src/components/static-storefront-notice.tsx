'use client';
import Link from 'next/link';
import {useShop} from './shop-context';

export default function StaticStorefrontNotice(){
  const s=useShop();
  return <main className="page-shell empty-state">
    <h1>{s.t('Пока только выбираем цветы','For now, explore the flowers')}</h1>
    <p>{s.t('На этом сайте доступны каталог, корзина и расчёт доставки. Регистрация, вход и оформление заказов здесь недоступны. Корзина сохраняется в вашем браузере.','You can browse the catalogue, save your cart and estimate delivery. Registration, sign-in and ordering are unavailable here. Your cart is saved in your browser.')}</p>
    <Link className="button primary" href="/cart">{s.t('Перейти в корзину','Go to cart')}</Link>
    <Link className="text-link" href="/catalog">{s.t('Выбрать цветы','Choose flowers')}</Link>
  </main>;
}
