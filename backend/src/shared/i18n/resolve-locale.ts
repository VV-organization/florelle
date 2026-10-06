import type { LocalizedField, Locale } from '../db/schema/types';

/**
 * Extract a string from a LocalizedField by locale.
 * Falls back to 'en' if the requested locale key is missing.
 */
export function resolveField(
  field: LocalizedField | null | undefined,
  lang: Locale,
): string | null {
  if (!field) return null;
  return field[lang] ?? field.en ?? null;
}

export const SUPPORTED_LOCALES: Locale[] = ['en', 'ru'];
export const DEFAULT_LOCALE: Locale = 'en';
