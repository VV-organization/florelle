import json,pathlib,urllib.request,concurrent.futures
root=pathlib.Path(__file__).resolve().parents[1];path=root/'src/data/catalog.json';data=json.loads(path.read_text())
def fetch(page):
 with urllib.request.urlopen(f'https://flower-point.com/api/v1/products?lang=ru&segment=b2b&currency=RUB&page_size=100&page={page}',timeout=30) as r:return json.load(r)['items']
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:wholesale={x['id']:x for page in ex.map(fetch,range(1,11)) for x in page}
cats={x['product']['category_id']:x['category'] for x in data['items'] if x.get('category')}
for x in data['items']:
 if not x.get('category'):x['category']=cats.get(x['product']['category_id'])
 w=wholesale.get(x['id'])
 if w:x['wholesale']={k:w[k] for k in ['seller_price','ams_price','available_units']}
missing={x['image']:x for x in data['items'] if not x['image'].startswith('/catalog/')}
def image(pair):
 url,x=pair
 try:
  with urllib.request.urlopen(url,timeout=30) as r:content=r.read()
  name=x['product']['id']+'.jpg';(root/'public/catalog'/name).write_bytes(content);return url,'/catalog/'+name
 except Exception as e:return url,None
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:resolved=dict(ex.map(image,missing.items()))
for x in data['items']:
 if x['image'] in resolved:
  if resolved[x['image']]:x['image']=resolved[x['image']]
  else:x['imageUnavailable']=True
path.write_text(json.dumps(data,ensure_ascii=False))
print('B2B listings',len(wholesale),'missing categories',sum(not x.get('category') for x in data['items']),'unavailable images',sum(x.get('imageUnavailable',False) for x in data['items']))
