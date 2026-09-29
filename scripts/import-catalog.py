import urllib.request,json,pathlib,concurrent.futures,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
(ROOT/'src/data').mkdir(parents=True,exist_ok=True)
(ROOT/'public/catalog').mkdir(parents=True,exist_ok=True)
BASE='https://flower-point.com/api/v1'
def get(path):
 with urllib.request.urlopen(BASE+path,timeout=40) as r:return json.load(r)
def page(n):return get(f'/products?lang=ru&segment=b2c&currency=RUB&page_size=100&page={n}')
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex: pages=list(ex.map(page,range(1,11)))
items=[i for p in pages for i in p['items']]
rates=get('/currency/rates')
collections=get('/collections?lang=ru&segment=b2c')
detail=get('/products/'+items[0]['product']['slug']+'?lang=ru&segment=b2b&currency=RUB')
(ROOT/'src/data/detail-example.json').write_text(json.dumps(detail,ensure_ascii=False))
def download(item):
 u=item['product']['image_url']; name=u.split('/')[-1].split('?')[0]; dest=ROOT/'public/catalog'/name
 try:
  if not dest.exists():dest.write_bytes(urllib.request.urlopen(u,timeout=30).read())
  item['image']='/catalog/'+name
 except Exception:item['image']=u
 return item
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:items=list(ex.map(download,items))
(ROOT/'src/data/catalog.json').write_text(json.dumps({'items':items,'facets':pages[0]['facets'],'rates':rates,'collections':collections,'importedAt':'2026-09-28','source':BASE},ensure_ascii=False))
print('Imported',len(items),'listings',len(list((ROOT/'public/catalog').glob('*'))),'images; rates:',rates)
