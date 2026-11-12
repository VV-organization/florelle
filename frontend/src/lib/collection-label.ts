/** Storefront labels; collection slugs remain the API identifiers. */
const labels: Record<string, {ru: string; en: string}> = {
  'premium-roses': {ru: 'Премиум-розы', en: 'Premium roses'},
  'spring-collection': {ru: 'Сезонный ассортимент', en: 'Seasonal selection'},
};
export function collectionLabel(slug: string, en: boolean, fallback: string): string {
  return labels[slug]?.[en ? 'en' : 'ru'] ?? fallback;
}
