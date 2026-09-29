"""Refresh existing offers without overwriting Florelle's edited copy or cutouts.
Read-only calls to the public source. Never touches customer or order APIs.
"""
import json,urllib.request,concurrent.futures,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE='https://flower-point.com/api/v1'
def read(path):
 with urllib.request.urlopen(BASE+path,timeout=40) as response:return json.load(response)
def refresh():
 catalog_path=ROOT/'src/data/catalog.json'
 data=json.loads(catalog_path.read_text())
 def page(task):
  segment,n=task
  return segment,read(f'/products?lang=ru&segment={segment}&currency=RUB&page_size=100&page={n}')
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  pages=list(pool.map(page,[(s,n) for s in ['b2c','b2b'] for n in range(1,11)]))
 offers={s:{p['id']:p for seg,page in pages if seg==s for p in page['items']} for s in ['b2c','b2b']}
 source={}
 for item in data['items']:
  retail=offers['b2c'][item['id']];wholesale=offers['b2b'][item['id']]
  assert retail['product']['id']==item['product']['id']
  for field in ['seller_price','available_units','box_quantity','currency','delivery_date']:item[field]=retail[field]
  item['wholesale']={k:wholesale[k] for k in ['seller_price','ams_price','available_units']}
  item.setdefault('source_image',item['image'])
  source[item['product']['id']]={'name':retail['product']['name'],'description':retail['product']['description'],'image_url':retail['product']['image_url'],'slug':retail['product']['slug']}
  # Image changes need review and re-segmentation, never replace a reviewed cutout silently.
  if retail['product']['image_url']!=item['product']['image_url']:raise RuntimeError('Source photograph changed: '+item['product']['name'])
 data['rates']=read('/currency/rates');data['pricesVerifiedAt']=datetime.date.today().isoformat()
 catalog_path.write_text(json.dumps(data,ensure_ascii=False))
 (ROOT/'scripts/catalog-source-copy.json').write_text(json.dumps(source,ensure_ascii=False,indent=2))
 print('Refreshed',len(data['items']),'offers and preserved',len(source),'source descriptions')
if __name__=='__main__':refresh()
