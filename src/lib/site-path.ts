export const staticStorefront = process.env.NEXT_PUBLIC_STATIC_STOREFRONT === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** Next Link/router add basePath themselves; use this only for public assets. */
export function assetPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || !basePath || path.startsWith(basePath + '/')) return path;
  return basePath + path;
}

export function routePath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}
