import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import type {Database} from '../../../shared/db/client';
import {queryListings} from '../catalog.queries';

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('catalog mixed filter with PostgreSQL', () => {
 const client = postgres(databaseUrl!, {max: 1});
 const db = drizzle(client) as Database;
 const sellerId = randomUUID(), categoryId = randomUUID();
 beforeAll(async () => {
  await client`insert into sellers (id,name,slug,country) values (${sellerId},'{"ru":"Test","en":"Test"}',${sellerId},'NL')`;
  await client`insert into categories (id,name,slug) values (${categoryId},'{"ru":"Test","en":"Test"}',${categoryId})`;
  for (const color of ['multicolor','mixed','blue','gold','sand','brown','unknown','']) {
   const productId = randomUUID();
   await client`insert into products (id,name,slug,species,color,image_url,category_id) values (${productId},'{"ru":"Test","en":"Test"}',${`old-multicolor-${productId}`},'flower',${color},'/test.webp',${categoryId})`;
   await client`insert into listings (product_id,seller_id,seller_price_usd,ams_price_usd,box_quantity,available_stems,delivery_date) values (${productId},${sellerId},1,1,100,1000,'2030-01-01')`;
  }
 });
 afterAll(async () => {
  await client`delete from listings where seller_id=${sellerId}`;
  await client`delete from products where category_id=${categoryId}`;
  await client`delete from categories where id=${categoryId}`;
  await client`delete from sellers where id=${sellerId}`;
  await client.end();
 });
 it('excludes unknown and single colours consistently from rows, count and facets', async () => {
  const result = await queryListings(db, {sellerId, color: 'mixed'}, 'featured', 1, 100);
  expect(result.rows.map(r => r.productColor).sort()).toEqual(['mixed','multicolor']);
  expect(result.total).toBe(2);
  expect(result.facets).toHaveLength(1);
  expect(result.facets[0].count).toBe(2);
 });
});
