"""Remove backgrounds locally; preserve RGB pixels and retain original source files.
Usage: U2NET_HOME=/path/to/cache python scripts/cutout-catalog.py
Dependencies: rembg[cpu]==2.0.61, Pillow. Model: isnet-general-use.
"""
import json,time,hashlib
from pathlib import Path
from PIL import Image,ImageOps,ImageDraw,ImageFilter
import numpy as np
from rembg import new_session,remove
ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'src/data/catalog.json').read_text())
images=list(dict.fromkeys(p.get('source_image',p['image']) for p in data['items']))
out=ROOT/'public/catalog/cutouts';out.mkdir(exist_ok=True)
session=new_session('isnet-general-use',providers=['CPUExecutionProvider'])
report=[];start=time.time()
for index,source in enumerate(images):
 name=Path(source).stem;target=out/(name+'.webp')
 original=ImageOps.exif_transpose(Image.open(ROOT/'public'/source.lstrip('/'))).convert('RGB')
 if not target.exists():
  result=remove(original,session=session)
  alpha=result.getchannel('A')
  # Be Sweet is held in a hand; a reviewed contour isolates its flower head.
  if name=='27849':
   points=[(x/2,y/2) for x,y in [(357, 135), (375, 141), (408, 134), (465, 128), (520, 134), (556, 140), (583, 154), (606, 170), (617, 194), (626, 222), (646, 244), (666, 273), (697, 298), (712, 324), (722, 359), (744, 376), (753, 381), (754, 401), (766, 431), (778, 466), (783, 500), (770, 510), (782, 541), (796, 572), (797, 605), (779, 625), (742, 651), (698, 679), (695, 703), (673, 732), (646, 745), (595, 754), (559, 784), (529, 813), (491, 842), (458, 861), (431, 876), (402, 870), (369, 857), (339, 838), (316, 814), (305, 791), (309, 775), (287, 787), (267, 775), (243, 756), (217, 742), (188, 726), (163, 713), (133, 698), (109, 689), (86, 681), (78, 655), (67, 639), (48, 632), (35, 615), (32, 598), (29, 575), (37, 558), (46, 541), (59, 508), (72, 478), (84, 445), (95, 408), (105, 369), (112, 342), (99, 324), (86, 310), (114, 304), (123, 279), (136, 243), (139, 233), (137, 221), (160, 222), (185, 214), (218, 201), (258, 187), (295, 176), (327, 162), (345, 148)]]
   contour=Image.new('L',original.size);ImageDraw.Draw(contour).polygon(points,fill=255)
   contour=contour.filter(ImageFilter.GaussianBlur(.45))
   alpha=contour
  if name=='33544':
   ImageDraw.Draw(alpha).polygon([(0,803),(0,777),(115,654),(146,621),(170,610),(180,617),(192,637),(202,650),(204,677),(182,703),(115,803)],fill=0)
  if name=='3616':
   alpha=Image.new('L',original.size)
   ImageDraw.Draw(alpha).rectangle((0,52,405,310),fill=255)
  # Suppress near-zero mask noise without erasing semi-transparent petal edges.
  alpha=alpha.point(lambda v:0 if v<8 else 255 if v>247 else v)
  result=original.convert('RGBA');result.putalpha(alpha)
  bounds=alpha.getbbox()
  if not bounds:raise RuntimeError(f'Empty foreground: {source}')
  result=result.crop(bounds)
  # Small transparent margin protects petals during card scaling.
  result=ImageOps.expand(result,border=max(6,round(max(result.size)*.025)),fill=(0,0,0,0))
  result.save(target,'WEBP',lossless=True,method=4)
 result=Image.open(target);a=np.asarray(result.getchannel('A'))
 report.append({'source':source,'output':'/catalog/cutouts/'+target.name,'size':result.size,'transparent':round(float((a==0).mean()),3),'opaque':round(float((a==255).mean()),3)})
 if index%20==0 or index==len(images)-1:print(f'{index+1}/{len(images)} images, {time.time()-start:.0f}s',flush=True)
(ROOT/'scripts/cutout-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('DONE',flush=True)
