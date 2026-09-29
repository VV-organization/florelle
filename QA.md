# Проверка 28.09.2026

## Сборка и API

- TypeScript и production build Next.js проходят.
- Интеграционные тесты: каталог 1000 уникальных предложений, локальные изображения, розничные и оптовые цены; регистрация и вход, HttpOnly cookie, неверный пароль, запрет чужого Origin, доступ к истории только своего аккаунта, отсутствие доступа у гостя, завершение сессии.
- Сервер отклоняет отрицательное количество, дубли позиций, неверный телефон и вес ниже минимального. Стоимость черновика вычисляется сервером и проверяется тестом.

## Браузер — настольный и 390 × 844

- Обложка переключается между зеленью и цветением; каталог и фотографии отображаются.
- Быстрый просмотр: добавление показывает нижнее уведомление внутри native dialog, основная кнопка меняется на ссылку в корзину. Ссылка закрывает окно и открывает корзину с товаром.
- Повторное добавление заменено переходом; состояние видно в каталоге, быстром просмотре и отдельной странице товара.
- Escape закрывает окно и возвращает фокус на кнопку быстрого просмотра. Закрытие уведомления работает.
- Количество меняет сумму, удаление последнего товара показывает пустую корзину. Перезагрузка сохраняет состав и валюту.
- Мобильный поиск Menta находит двух поставщиков, категория «Пионы» отбирает 9 предложений; фильтры раскрываются и закрываются. Горизонтального переполнения страницы нет.
- Регистрация из оформления возвращает в корзину. Тестовый заказ с получателем, телефоном, адресом и датой сохранён и виден в истории с тем же составом и суммой.
- Оптовая доставка, Стамбул: 100 кг = 2400 TRY, вес 1 кг не даёт допустимого тарифа. Проверен пересчёт в KZT и перевод интерфейса на английский.

Не проверялись реальные платежи, отправка писем и выполнение доставки: соответствующие поставщики не подключены. Снимок каталога не является гарантией текущих остатков.


## 2026-09-29: deployment and botanical motion

- First GitHub Actions run 36519495319 passed: Linux npm ci/build/typecheck, Docker build, live container assets/health and account/order API tests.
- Local standalone production server: health, registration, session, order draft, cross-user isolation and logout passed.
- WebGL compiled in browser without errors; full bloom toggle and keyboard Enter work in both directions. Cursor reveal has an opaque center and feathered perimeter; foliage frames change while heading bounds remain identical.
- Reduced-motion CSS fallback keeps the bloom toggle available; renderer responds to preference changes and pauses outside viewport/hidden tabs.
- Local database files are excluded from Git, Docker context and standalone tracing.


## 2026-09-29: cutouts and refreshed catalog

- All 1000 offers point to 483 existing RGBA WebP files; every file contains transparent and opaque pixels. Original photographs retained.
- 511 RU/EN product descriptions rewritten; no displayed RU description equals its source. Original copy retained for review.
- Retail and wholesale prices refreshed from public Flower Point API.
- Contact sheets reviewed across the full image set; difficult pale images refined with BiRefNet and selected edges corrected manually.
- Safari: Be Sweet card has no hand/pavement background; quick view shows the new description and price. Add → visible modal confirmation → cart navigation → correct item and box total verified. Test item removed afterward.

### Entry arch transition (2026-09-29)
- Inspected ERA's public opening mask, CSS layers and timeline: 560×2592 profile with a 16px inset; 1.5s rise, second phase at 90%, 2.4s expansion; cubic curves (.75,0,.25,1) and (.6,0,0,1); 992px breakpoint.
- Both gateway links use a persistent layout overlay; no reload or intermediate blank page. Full-bleed botanical art zooms from 1.15 to 1 to prevent image edges being exposed.
- Browser checked wholesale and retail destinations, intermediate frames, return to gateway, 390×844 layout, scroll/inert cleanup and destination focus. Reduced-motion preference bypasses the transition; modified link clicks retain native navigation.
- TypeScript and production build pass.

### Horizontal flower selection (2026-09-29)
- Replaced the home selection grid with eight staggered product cards following Sobha's TENETS horizontal gallery rhythm.
- Desktop browser: vertical movement translates the rail; sticky stage remains at y=0; keyboard focus brings distant cards into view.
- Mobile 390×844: native horizontal overflow, no pinned section or document-width overflow.
- Verified quick view → add Quicksand → live confirmation inside dialog → cart contains one 350-stem box. Removed the test item afterwards.
- Production build and TypeScript pass.

## Florelle logo — 2026-09-29
- Original eight-petal seal with RU/EN circular inscription; elongated outlined serif wordmark. Integrated entry/header/footer; matching favicon.
- Browser: desktop gateway/header and mobile 390px header/footer inspected. All logo SVGs loaded; no horizontal overflow at mobile width. English toggle changes the seal and caption. Gateway → B2B arch completed; footer logo link targets B2B home.
- `npm run build`: passed after final changes (including TypeScript and standalone preparation).

## Approved script and seal revision — 2026-09-29
- Passions Conflict RUS applied to .script/.handwritten; optical size adjusted for hero, section and delivery accents. OFL included.
- Enlarged seal inscription; removed side wordmark from all BrandLogo instances.
- Main B2B inspected at 375px layout width: no horizontal overflow; hero script right edge 321px, computed family Passions Conflict RUS. Gateway and seal inspected.
- Four fixed-Passions heading/body combinations at /type-study/pairings.html; all four switches verified, mobile composition inspected. Production heading/body selection remains unchanged.
- Production build and TypeScript passed.

## Approved production type system — 2026-09-29
- Prata Regular for headings/product titles, Manrope Variable for body/UI, Passions Conflict RUS for accents. Self-hosted WOFF2 and OFL licenses; preload all three. Previous fonts and comparison pages archived outside public/Git/Docker.
- Standalone packaging clears old public/static output before copying; CI checks the new font files. Added production smoke test for WOFF2 signatures and 404 responses for retired fonts/studies.
- All 483 catalog photo paths exist. No public font family outside the approved three.
- Production on :5195 with isolated /tmp database: account/session/security/order-draft tests and asset cleanup tests passed. Build and TypeScript passed.
- Browser: desktop home; 390px gateway, home, catalog, cart, delivery, account, quick view. Correct Prata 400 / Manrope computed fonts; no page overflow. Adjusted initial script strokes on delivery/account pages. English delivery width checked.
- Quick view Menta → add → visible confirmation inside native dialog → cart item present → reload → catalog primary action links to cart; reopening quick view also offers cart navigation without duplicate add. Escape closes dialog.
