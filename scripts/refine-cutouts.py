"""Re-segment visually reviewed difficult pale flowers with BiRefNet General Lite."""
from pathlib import Path
import json,time
from PIL import Image,ImageOps
from rembg import new_session,remove
ROOT=Path(__file__).resolve().parents[1]
names=['1018','5524','1584','27104','3309','30089','28206','28844','24714','30394','26302','27055','31464','27094','26695','27786','27768','3713','245','33946','31375','28842','32256','32241','32064','32328','1156','2248','30337','2842']
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
(ROOT/'scripts/cutout-refinements.json').write_text(json.dumps({'model':'birefnet-general-lite','images':names},indent=2))
