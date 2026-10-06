export const GOOGLE_ID = 'G-JDQFXEK0GD';
export const YANDEX_ID = 113471772;

export const googleBootstrap = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_ID}');
`;

export const yandexBootstrap = `
window.dataLayer = window.dataLayer || [];
(function(m,e,t,r,i,k,a){
  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
  m[i].l=1*new Date();
  for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
  k=e.createElement(t);a=e.getElementsByTagName(t)[0];k.async=1;k.src=r;a.parentNode.insertBefore(k,a);
})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_ID}','ym');
ym(${YANDEX_ID},'init',{
  defer:true,ssr:true,webvisor:true,clickmap:true,ecommerce:'dataLayer',
  referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true
});
`;

export type Metrika = (id: number, action: string, ...args: unknown[]) => void;

// Do not consume a page view until the bootstrap queue exists. The same URL
// can legitimately be visited again after navigating elsewhere (Back/Forward).
export function trackMetrikaPage(
  ym: Metrika | undefined,
  previous: string | null,
  url: string,
  title: string,
  referrer: string,
): string | null {
  if (!ym || previous === url) return previous;
  ym(YANDEX_ID, 'hit', url, {title, referer: previous ?? referrer});
  return url;
}
