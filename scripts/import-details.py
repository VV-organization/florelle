import json,urllib.request,pathlib,concurrent.futures
root=pathlib.Path(__file__).resolve().parents[1];path=root/'src/data/catalog.json';data=json.loads(path.read_text())
slugs=list(dict.fromkeys(x['product']['slug'] for x in data['items']))
def read(slug):
 try:
  with urllib.request.urlopen('https://flower-point.com/api/v1/products/'+slug+'?lang=ru&segment=b2b&currency=RUB',timeout=30) as r:return slug,json.load(r)
 except Exception as e:return slug,{'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:details=dict(ex.map(read,slugs))
for item in data['items']:
 d=details[item['product']['slug']]
 if 'error' in d:continue
 for k in ['color','stem_length_cm','head_size','category']:item[k]=d.get(k)
 item['wholesale']=next((x for x in d['listings'] if x['id']==item['id']),None)
path.write_text(json.dumps(data,ensure_ascii=False));print('Details',len(details),'errors',sum('error'in d for d in details.values()))
