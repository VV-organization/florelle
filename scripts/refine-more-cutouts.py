"""Re-segment visually reviewed difficult pale flowers with BiRefNet General Lite."""
from pathlib import Path
import json,time
from PIL import Image,ImageOps
from rembg import new_session,remove
ROOT=Path(__file__).resolve().parents[1]
names=['32274', '32247', '31870', '32809', '32863', '32953', '28238', '226', '22147', '30189', '20326', '3501', '1711', '31862', '27905', '5441', '33317', '34007', '3660', '441', '1806', '249', '18280']
s=new_session('birefnet-general-lite',providers=['CPUExecutionProvider']);start=time.time()
for i,name in enumerate(names):
 original=ImageOps.exif_transpose(Image.open(ROOT/'public/catalog'/f'{name}.jpg')).convert('RGB')
 cached=Path('/tmp')/f'florelle-{name}-biref.png'
 result=Image.open(cached) if cached.exists() else remove(original,session=s)
 alpha=result.getchannel('A').point(lambda v:0 if v<8 else 255 if v>247 else v)
 result=original.convert('RGBA');result.putalpha(alpha);bounds=alpha.getbbox()
 if not bounds:raise RuntimeError(name)
 result=result.crop(bounds);result=ImageOps.expand(result,border=max(6,round(max(result.size)*.025)),fill=(0,0,0,0))
 result.save(ROOT/'public/catalog/cutouts'/f'{name}.webp','WEBP',lossless=True,method=4)
 print(f'{i+1}/{len(names)} {name}, {time.time()-start:.0f}s',flush=True)
(ROOT/'scripts/cutout-refinements-more.json').write_text(json.dumps({'model':'birefnet-general-lite','images':names},indent=2))
