import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { CatalogService } from './catalog.service';
import { z } from 'zod';
import {
  productsQuerySchema,
  paginatedListingsSchema,
  slugParamSchema,
  currencyQuerySchema,
  productDetailSchema,
  sellerSchema,
  categoryListItemSchema,
  collectionSchema,
  collectionDetailSchema,
  langSchema,
} from './catalog.schema';

export function buildCatalogRouter(
  catalogService: CatalogService,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      '/products',
      {
        schema: {
          tags: ['catalog'],
          querystring: productsQuerySchema,
          response: { 200: paginatedListingsSchema },
        },
      },
      async (request) => {
        return catalogService.getListings(request.query);
      },
    );

    typed.get(
      '/products/:slug',
      {
        schema: {
          tags: ['catalog'],
          params: slugParamSchema,
          querystring: currencyQuerySchema,
          response: { 200: productDetailSchema },
        },
      },
      async (request) => {
        return catalogService.getProductBySlug(
          request.params.slug,
          request.query.currency,
          request.query.lang,
          request.query.segment,
        );
      },
    );

    typed.get(
      '/sellers',
      {
        schema: {
          tags: ['catalog'],
          querystring: z.object({ lang: langSchema }),
          response: { 200: z.array(sellerSchema) },
        },
      },
      async (request) => {
        return catalogService.getSellers(request.query.lang);
      },
    );

    typed.get(
      '/categories',
      {
        schema: {
          tags: ['catalog'],
          querystring: z.object({ lang: langSchema }),
          response: { 200: z.array(categoryListItemSchema) },
        },
      },
      async (request) => {
        return catalogService.getCategories(request.query.lang);
      },
    );

    typed.get(
      '/collections',
      {
        schema: {
          tags: ['catalog'],
          querystring: z.object({ lang: langSchema }),
          response: { 200: z.array(collectionSchema) },
        },
      },
      async (request) => {
        return catalogService.getCollections(request.query.lang);
      },
    );

    typed.get(
      '/collections/:slug',
      {
        schema: {
          tags: ['catalog'],
          params: slugParamSchema,
          querystring: currencyQuerySchema,
          response: { 200: collectionDetailSchema },
        },
      },
      async (request) => {
        return catalogService.getCollectionBySlug(
          request.params.slug,
          request.query.currency,
          request.query.lang,
          request.query.segment,
        );
      },
    );
  };

  return plugin;
}
