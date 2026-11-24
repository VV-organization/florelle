'use client';

import type {ReactNode} from 'react';
import {useShop} from './shop-context';

export default function LegalPreview({kind, children}: {kind: 'privacy' | 'terms'; children: ReactNode}) {
  const s = useShop();
  return (
    <main className="page-shell legal-page">
      <h1>{kind === 'privacy'
        ? s.t('Политика конфиденциальности','Privacy Policy')
        : s.t('ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ','User Agreement')}</h1>
      <article lang="ru">{children}</article>
    </main>
  );
}
