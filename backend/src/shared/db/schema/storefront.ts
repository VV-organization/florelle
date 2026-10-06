import { jsonb, pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
export interface MediaPhoto {url:string;variants:Array<{src:string;width:number;height:number}>;framing?:{bottom:number;width:number;height:number}}
export const mediaAssets=pgTable('media_assets',{
 sourcePath:text('source_path').primaryKey(),checksum:text('checksum').notNull(),filename:text('filename').notNull(),bytes:integer('bytes').notNull(),contentType:text('content_type').notNull(),metadata:jsonb('metadata').notNull().$type<MediaPhoto>(),
});
export const storefrontSettings=pgTable('storefront_settings',{
 key:text('key').primaryKey(),value:jsonb('value').notNull().$type<unknown>(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
