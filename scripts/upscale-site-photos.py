"""Local photo restoration with the official Real-ESRGAN NCNN executable.
Original files are never overwritten. Usage: python scripts/upscale-site-photos.py
--runtime /path/to/runtime [--limit N]. Requires Pillow; model: realesrgan-x4plus.
Outputs responsive WebP files plus a reproducible provenance/quality manifest.
"""
import argparse,hashlib,json,subprocess,time
from pathlib import Path
from PIL import Image,ImageOps

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--runtime',type=Path,required=True);parser.add_argument('--limit',type=int);parser.add_argument('--force',action='store_true');parser.add_argument('--only',nargs='*');args=parser.parse_args()
work=ROOT/'output/image-quality/work';work.mkdir(parents=True,exist_ok=True)
out=ROOT/'public/catalog/hd';out.mkdir(parents=True,exist_ok=True)
manifest_path=ROOT/'src/data/image-quality.json'
manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
paths=sorted((ROOT/'public/catalog/cutouts').glob('*.webp'),key=lambda p:(p.stem not in ['2779','27849','4354','3309','3730'],p.name))
paths=[p for p in paths if p.stem!='1018']
paths += [ROOT/'public/images'/n for n in ['botanical-green.jpg','botanical-bloom.jpg','source-flowers.jpg']]
if args.only:paths=[p for p in paths if p.stem in args.only]
if args.limit:paths=paths[:args.limit]
def ai(source,target,model):
 with (work/'inference.log').open('a') as log:
  subprocess.run([str(args.runtime/'realesrgan-ncnn-vulkan'),'-i',str(source),'-o',str(target),'-m',str(args.runtime/'models'),'-n',model,'-s','4','-t','256','-j','1:1:1'],stdout=log,stderr=log,check=True)
def resize(im,long):
 return im.resize((max(1,round(im.width*long/max(im.size))),max(1,round(im.height*long/max(im.size)))),Image.Resampling.LANCZOS)
start=time.time()
for index,p in enumerate(paths):
 key='/'+str(p.relative_to(ROOT/'public'));digest=hashlib.sha256(p.read_bytes()).hexdigest()
 if not args.force and key in manifest and manifest[key].get('sha256')==digest and all((ROOT/'public'/r['src'].lstrip('/')).exists() for r in manifest[key]['variants']):
  print(f'SKIP {index+1}/{len(paths)} {p.name}',flush=True);continue
 stamp=time.time();original=ImageOps.exif_transpose(Image.open(p)).convert('RGBA');photo=p.parent.name=='images'
 source=p
 if (ROOT/'public/catalog/restored'/(p.stem+'.png')).exists():
  enhanced=Image.open(ROOT/'public/catalog/restored'/(p.stem+'.png')).convert('RGBA');method='reviewed-imagegen-restoration';passes=0
 else:
  model='RealESRGAN_General_x4_v3' if max(original.size)>=600 else 'realesrgan-x4plus'
  temp=work/(p.stem+'-x4.png');ai(source,temp,model);enhanced=Image.open(temp).convert('RGBA');passes=1
  # Small thumbnails benefit from a second restoration pass; preserve the original silhouette below.
  if max(enhanced.size)<1200:
   intermediate=resize(enhanced,400);intermediate.save(work/'second-pass.png');ai(work/'second-pass.png',work/'second-pass-result.png',model);enhanced=Image.open(work/'second-pass-result.png').convert('RGBA');passes=2
  if not photo:enhanced.putalpha(original.getchannel('A').resize(enhanced.size,Image.Resampling.LANCZOS))
  method=model
 max_edge=3072 if photo else min(1800,max(enhanced.size))
 enhanced=resize(enhanced,max_edge)
 variants=[]
 for edge in ([960,1920,3072] if photo else [640,1024,max_edge]):
  edge=min(edge,max_edge)
  if any(v['edge']==edge for v in variants):continue
  im=resize(enhanced,edge)
  if photo:im=im.convert('RGB')
  target=out/(p.stem+'-'+str(edge)+'.webp');im.save(target,'WEBP',quality=94,method=4,alpha_quality=100)
  variants.append({'src':'/'+str(target.relative_to(ROOT/'public')),'width':im.width,'height':im.height,'edge':edge,'bytes':target.stat().st_size})
 manifest[key]={'sha256':digest,'original':[original.width,original.height],'method':method,'passes':passes,'variants':variants}
 manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
 print(f'OK {index+1}/{len(paths)} {p.name} {original.size} -> {enhanced.size} {time.time()-stamp:.1f}s elapsed {time.time()-start:.0f}s',flush=True)
print('DONE',len(manifest),'unique photos',flush=True)
