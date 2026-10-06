# Analytics

Production builds initialize GA4 `G-JDQFXEK0GD` and Yandex Metrika `113471772`
once in the root layout using `next/script` with `afterInteractive`. Development
builds do not load either counter. No visual styling is changed.

- GA4 sends the initial view through `config`. In the GA4 web stream, keep
  **Enhanced measurement → Page views → Page changes based on browser history
  events** enabled. There is no additional manual `page_view` sender.
- Metrika uses `defer: true` and explicit `hit` calls for the first page and
  pathname/query changes. Calls wait for the bootstrap queue, deduplicate the
  current URL and use the previous page as `referer` on SPA navigation.
- Webvisor, clickmap, accurateTrackBounce and trackLinks are enabled as requested.
  Personal account, registration and checkout/order content is masked with
  `ym-hide-content`; personal input fields also use `ym-disable-keys`.
- Both counters preserve the shared `window.dataLayer`. The Metrika ecommerce
  channel is enabled, but product/cart/purchase events are not implemented by
  this counter installation. Never infer a purchase from a payment redirect.

After deployment, check a first visit, catalog navigation, filters and Back in
GA4 DebugView/Realtime and Metrika diagnostics. Expect one view per navigation.
Provider report access is required to verify receipt; published scripts and
passing local tests alone do not establish ingestion.

References:
- https://nextjs.org/docs/app/guides/scripts
- https://developers.google.com/analytics/devguides/collection/ga4/single-page-applications
- https://yandex.ru/support/metrica/ru/code/counter-spa-setup
- https://yandex.ru/support/metrica/ru/webvisor/settings

Local references reviewed: Flower Point, Onyxshop and LuxeBeauty analytics
components. Their counter IDs and deployment configuration were not reused.
