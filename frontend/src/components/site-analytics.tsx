'use client';

import Script from 'next/script';
import {usePathname, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {GOOGLE_ID, YANDEX_ID, googleBootstrap, yandexBootstrap, trackMetrikaPage, type Metrika} from '@/lib/analytics';

declare global {
  interface Window { ym?: Metrika }
}

function Counters() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [ready, setReady] = useState(false);
  const previousUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    previousUrl.current = trackMetrikaPage(
      window.ym, previousUrl.current, window.location.href, document.title, document.referrer,
    );
  }, [ready, pathname, search]);

  return <>
    {/* GA4 Enhanced Measurement owns history page views; no manual page_view. */}
    <Script id="google-analytics-init" strategy="afterInteractive">{googleBootstrap}</Script>
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ID}`} strategy="afterInteractive"/>
    <Script id="yandex-metrika-init" strategy="afterInteractive" onReady={() => setReady(true)}>{yandexBootstrap}</Script>
  </>;
}

export default function SiteAnalytics() {
  if (process.env.NODE_ENV !== 'production') return null;
  return <>
    <Suspense fallback={null}><Counters/></Suspense>
    <noscript><div><img src={`https://mc.yandex.ru/watch/${YANDEX_ID}`} style={{position:'absolute',left:'-9999px'}} alt=""/></div></noscript>
  </>;
}
