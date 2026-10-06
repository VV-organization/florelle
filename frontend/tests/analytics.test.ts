import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {googleBootstrap, yandexBootstrap, trackMetrikaPage, GOOGLE_ID, YANDEX_ID} from '../src/lib/analytics.ts';

test('both bootstraps preserve a shared ecommerce queue and defer the automatic Metrika hit', () => {
  const dataLayer: unknown[] = [{ecommerce: {detail: 'existing event'}}];
  const inserted: {src?: string}[] = [];
  const context = vm.createContext({
    dataLayer,
    location: {href: 'https://bloom-send.com/catalog'},
    document: {
      referrer: 'https://example.com/', scripts: [],
      createElement: () => ({}),
      getElementsByTagName: () => [{parentNode: {insertBefore: (node: {src?: string}) => inserted.push(node)}}],
    },
  });
  vm.runInContext('window = this', context);
  vm.runInContext(googleBootstrap, context);
  vm.runInContext(yandexBootstrap, context);
  assert.equal(context.dataLayer, dataLayer);
  assert.equal(dataLayer.length, 3);
  assert.deepEqual(Array.from(dataLayer[2] as ArrayLike<unknown>), ['config', GOOGLE_ID]);
  const init = context.ym.a[0];
  assert.equal(init[0], YANDEX_ID);
  assert.equal(init[1], 'init');
  assert.equal(init[2].defer, true);
  assert.equal(init[2].webvisor, true);
  assert.equal(init[2].ecommerce, 'dataLayer');
  assert.equal(inserted[0].src, `https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_ID}`);
});

test('delayed initialization does not consume the first view', () => {
  const calls: unknown[][] = [];
  let previous = trackMetrikaPage(undefined, null, '/catalog', 'Catalog', 'https://example.com/');
  assert.equal(previous, null);
  previous = trackMetrikaPage((...args) => calls.push(args), previous, '/catalog', 'Catalog', 'https://example.com/');
  assert.equal(previous, '/catalog');
  assert.deepEqual(calls, [[YANDEX_ID, 'hit', '/catalog', {title: 'Catalog', referer: 'https://example.com/'}]]);
});

test('rerenders are deduplicated while query changes and Back navigation count with the previous page referrer', () => {
  const calls: unknown[][] = [];
  let previous: string | null = null;
  for (const url of ['/catalog', '/catalog', '/catalog?category=roses', '/cart', '/catalog?category=roses']) {
    previous = trackMetrikaPage((...args) => calls.push(args), previous, url, 'Florelle', 'https://example.com/');
  }
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(call => (call[3] as {referer: string}).referer), [
    'https://example.com/', '/catalog', '/catalog?category=roses', '/cart',
  ]);
});
