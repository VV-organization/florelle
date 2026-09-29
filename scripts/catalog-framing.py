"""Measure transparent margins and identify stem compositions for card framing.
Only generates layout metadata; never modifies source photographs.
"""
import json
from pathlib import Path
from PIL import Image
import numpy as np
root=Path(__file__).resolve().parents[1]
frames={}
for path in sorted((root/'public/catalog/cutouts').glob('*.webp')):
 im=Image.open(path).convert('RGBA'); a=np.array(im); x,y,r,b=im.getchannel('A').getbbox()
 crop=a[y:b,x:r]; lower=crop[int(len(crop)*.7):].astype(float)
 visible=lower[:,:,3]>128
 green=(lower[:,:,1]>lower[:,:,0]*1.04)&(lower[:,:,1]>lower[:,:,2]*1.05)&visible
 greenery=float(green.sum()/max(1,visible.sum()))
 flat=float((crop[-3:,:,3]>128).sum()/3/(r-x))
 if greenery>.18 or flat>.15:
  frames['/catalog/cutouts/'+path.name]={'bottom':round((im.height-b)/im.height*100+2,2),'width':im.width,'height':im.height}
(root/'src/data/image-framing.json').write_text(json.dumps(frames,indent=2)+'\n')
print(f'{len(frames)} stem / cropped compositions anchored to card edge')
