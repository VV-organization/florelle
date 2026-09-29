"""Build the Florelle vector identity from original geometry and OFL glyphs."""
from pathlib import Path
from math import pi,sin,cos
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

out=Path('public/brand');out.mkdir(exist_ok=True)
serif=TTFont('assets/brand-source/oranienbaum.ttf')
sans=TTFont('assets/brand-source/google-sans.ttf')
milk='#f5f1eb'
def glyph(font,char):
 name=font.getBestCmap()[ord(char)]; gs=font.getGlyphSet(); pen=SVGPathPen(gs);gs[name].draw(pen)
 return pen.getCommands(),font['hmtx'][name][0]
def wordmark(color):
 x=0; paths=[]
 for char in 'FLORELLE':
  d,a=glyph(serif,char);paths.append(f'<path transform="translate({x} 0)" d="{d}"/>');x+=a+65
 cap=serif['OS/2'].sCapHeight
 return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x*.73:.2f} {cap+28}" fill="{color}"><title>FLORELLE</title><g transform="translate(0 {cap+14}) scale(.73 -1)">'+''.join(paths)+'</g></svg>'
def flower():
 # Eight curved petals with a pointed join and a small open centre.
 petals=''.join(f'<path transform="rotate({a} 60 60)" d="M60 53 C52 47 50 37 60 28 C70 37 68 47 60 53Z"/>' for a in range(0,360,45))
 veins=''.join(f'<path transform="rotate({a} 60 60)" d="M60 51 C57.5 44 58 37 60 31"/>' for a in range(0,360,45))
 return '<g fill="none" stroke="currentColor" stroke-width="1.05" stroke-linejoin="round">'+petals+'<circle cx="60" cy="60" r="4.5"/></g><g fill="none" stroke="currentColor" stroke-width=".45">'+veins+'</g>'
def arc(text,top=True):
 size=13 if top else 10; scale=size/sans['head'].unitsPerEm; tracking=2.8 if top else 1.05
 widths=[glyph(sans,c)[1]*scale for c in text];total=sum(widths)+tracking*(len(text)-1);offset=-total/2;pieces=[];r=47
 for c,w in zip(text,widths):
  theta=(offset+w/2)/r;offset+=w+tracking
  angle=theta*180/pi
  if top: xx=60+r*sin(theta);yy=60-r*cos(theta); rot=angle
  else: xx=60+r*sin(theta);yy=60+r*cos(theta);rot=-angle
  d,_=glyph(sans,c)
  pieces.append(f'<path transform="translate({xx:.4f} {yy:.4f}) rotate({rot:.4f}) translate({-w/2:.4f} 0) scale({scale:.6f} {-scale:.6f})" d="{d}"/>')
 return ''.join(pieces)
for lang,subtitle in [('ru','ЦВЕТОЧНОЕ АТЕЛЬЕ'),('en','FLOWER ATELIER')]:
 for tone,color in [('cream',milk),('plum','#2c1928')]:
  svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="{color}" color="{color}"><title>FLORELLE · {subtitle}</title>'+arc('FLORELLE')+arc(subtitle,False)+'<circle cx="11" cy="60" r="1.1"/><circle cx="109" cy="60" r="1.1"/>'+flower()+'</svg>'
  (out/f'florelle-seal-{lang}-{tone}.svg').write_text(svg)
  (out/f'florelle-ring-{lang}-{tone}.svg').write_text(svg.replace(flower(),''))
for tone,color in [('cream',milk),('plum','#2c1928')]: (out/f'florelle-wordmark-{tone}.svg').write_text(wordmark(color))
(out/'florelle-flower.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 24 72 72" color="{milk}"><title>Florelle flower</title>'+flower()+'</svg>')
Path('public/favicon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 20 80 80" color="{milk}"><rect x="20" y="20" width="80" height="80" rx="18" fill="#2c1928"/>'+flower()+'</svg>')

(out/'florelle-flower-centered.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" color="{milk}">'+flower()+'</svg>')
