"""Write concise Florelle copy from verified source facts, without changing product specs.
Original descriptions remain in catalog-source-copy.json for review.
"""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'src/data/catalog.json';data=json.loads(path.read_text())
source=json.loads((ROOT/'scripts/catalog-source-copy.json').read_text())
colors=[
 ('персиково-розов',('персиково-розовая','peach pink')),
 ('кремово-бел|молочно-бел',('кремово-белая','creamy white')),
 ('лаванд|сиренев',('сиренево-лавандовая','lavender lilac')),
 ('пудрово-песоч|бежево-розов',('пудрово-бежевая','powder beige')),
 ('темно-розов|тёмно-розов|фукси|малинов',('насыщенная розовая','deep pink')),
 ('светло-розов|нежно-розов',('светло-розовая','pale pink')),
 ('персик|абрикос',('персиковая','peach')),
 ('бордов|винн',('бордовая','burgundy')),
 ('коралл|лосос',('коралловая','coral')),
 ('оранж',('оранжевая','orange')),
 ('красн',('красная','red')),
 ('желт|жёлт',('жёлтая','yellow')),
 ('розов',('розовая','pink')),
 ('фиолет',('фиолетовая','purple')),
 ('голуб|синег|синяя|синю',('синяя','blue')),
 ('зелен|зелён',('зелёная','green')),
 ('крем|слоновой',('кремовая','cream')),
 ('бел',('белая','white')),
 ('коричнев|шоколад',('коричневая','brown')),
 ('золот',('золотистая','gold')),
]
color_codes={'multicolor':('многоцветная','multicoloured'),'white':('белая','white'),'pink':('розовая','pink'),'light-pink':('светло-розовая','pale pink'),'dark-pink':('насыщенная розовая','deep pink'),'yellow':('жёлтая','yellow'),'orange':('оранжевая','orange'),'red':('красная','red'),'peach':('персиковая','peach'),'purple':('фиолетовая','purple'),'lilac-lavander':('сиренево-лавандовая','lavender lilac'),'cream':('кремовая','cream'),'green':('зелёная','green'),'cerise-salmon':('кораллово-розовая','coral pink'),'blue':('синяя','blue'),'sand':('песочная','sandy beige'),'burgundy':('бордовая','burgundy'),'gold':('золотистая','gold'),'brown':('коричневая','brown')}
traits=[
 (r'бархат',('бархатистая фактура лепестков','velvety petal texture')),
 (r'рюш|волнист|гофр',('волнистые края лепестков','ruffled petal edges')),
 (r'игольчат',('тонкие игольчатые лепестки','fine needle-like petals')),
 (r'помпон',('помпонная форма цветка','pompon-shaped flowers')),
 (r'шаровид|полушар',('округлая форма соцветия','rounded flower heads')),
 (r'садов.{0,18}(форм|раскры|бутон)|садовой роз',('садовая форма раскрытия','garden-style opening')),
 (r'махров',('многослойное махровое раскрытие','layered double flowers')),
 (r'плотн.{0,12}лепест',('плотно сложенные лепестки','densely layered petals')),
 (r'крупн.{0,12}(бутон|голов)',('крупный бутон','a large flower head')),
 (r'нескольк.{0,18}бутон|ветвист',('несколько бутонов на ветвистом стебле','several buds on a branching stem')),
 (r'зелен.{0,12}середин|зелён.{0,12}середин',('контрастная зелёная серединка','a contrasting green centre')),
 (r'темн.{0,12}середин|тёмн.{0,12}середин',('тёмная серединка','a dark centre')),
 (r'(сильн|выраженн).{0,8}аромат',('выраженный аромат','a noticeable fragrance')),
]
uses=[
 (r'свадеб',('свадебного оформления','wedding arrangements')),
 (r'монобук',('монобукетов','single-variety bouquets')),
 (r'настольн',('настольных композиций','table arrangements')),
 (r'осенн',('осенних букетов','autumn bouquets')),
 (r'летн',('летних композиций','summer arrangements')),
 (r'романт',('романтичных букетов','romantic bouquets')),
 (r'подароч',('подарочных букетов','gift bouquets')),
 (r'интерьер',('интерьерных композиций','interior arrangements')),
 (r'контраст',('контрастных сочетаний','contrasting combinations')),
 (r'празднич|торжеств',('праздничного оформления','celebration flowers')),
 (r'витрин',('оформления витрины','shop displays')),
]
# Individual editorial copy for the most visible varieties.
custom={
'Menta':'У Menta приглушённый лавандово-сиреневый оттенок с винтажным характером. В свадебном букете эту розу можно соединить с белыми и кремовыми цветами, сохранив спокойную пастельную гамму.',
'Be Sweet':'Тёплый персиковый цвет Be Sweet переходит в мягкий розовый. Роза впишется в нежный подарочный или свадебный букет; для сочетания подойдут кремовые цветы, эвкалипт и сухие фактуры.',
'MAYRAS WHITE':'MAYRAS WHITE раскрывается широкой садовой чашей. По описанию поставщика, лепестки имеют молочно-белую многоцветную окраску — для светлой свадебной флористики и интерьерных композиций.',
'Mondial':'Белый Mondial сохраняет классический силуэт розы и спокойную светлую гамму. Подходит для свадебного букета, церемонии или лаконичной композиции с зеленью.',
'Orange Crush':'Насыщенный оранжевый Orange Crush станет тёплым акцентом букета. Его можно включить в летнюю или осеннюю палитру, добавив жёлтые и коралловые цветы.',
'Bumblebee':'Bumblebee — жёлтая роза на высоком стебле. Солнечный оттенок хорошо поддержит летнюю композицию или праздничный букет с оранжевыми цветами.',
'Hearts':'У красной Hearts бархатистые лепестки и полное раскрытие, напоминающее садовую розу. Выразительный сорт для романтичного букета или торжественного оформления.',
'Freedom':'Крупный бутон Freedom собран из плотных красных лепестков. Классическая роза для монобукета, подарка или праздничной композиции.',
'Explorer':'У Explorer крупный бутон и глубокий красный оттенок с бархатистым эффектом. Этот сорт можно выбрать для торжественного букета с более тёмной, сдержанной палитрой.',
'Quicksand':'Quicksand соединяет песочный, пудровый и бежево-розовый оттенки. Роза подходит для нюдового свадебного букета; рядом с эвкалиптом её сложная гамма остаётся главным акцентом.',
'Pink Floyd':'Крупный бутон Pink Floyd окрашен в насыщенный розовый, близкий к фуксии. Такая роза добавит цветовой акцент в букет, фотозону или оформление события.',
'White O hara':'Кремово-белая White O Hara раскрывается крупным садовым цветком с выраженным ароматом. Подойдёт для светлого свадебного букета, арки и торжественной композиции.',
}
written={}
for item in data['items']:
 pid=item['product']['id']
 if pid not in written:
  name=item['product']['name'];text=source[pid]['description'];first=re.split(r'\.\s',text,maxsplit=1)[0].lower()
  category=(item.get('category') or {}).get('name','Цветы').lower()
  en_category=(item.get('category') or {}).get('name_en','flowers').lower()
  palette=None
  if re.search(r'многоцвет|микс|подборк|смесь',first):palette=('многоцветная','multicoloured')
  else:
   for pattern,color in colors:
    if re.search(pattern,first):palette=color;break
  if not palette:palette=color_codes.get(item.get('color'))
  selected_traits=[pair for pattern,pair in traits if re.search(pattern,first)][:2]
  selected_uses=[pair for pattern,pair in uses if re.search(pattern,text.lower())][:2]
  ru=f'{name} — {category}.'
  en=f'{name} — {en_category}.'
  if palette:ru+=f' Цветовая гамма — {palette[0]}.';en+=f' Colour palette: {palette[1]}.'
  if selected_traits:
   ru+=' У сорта '+ ' и '.join(t[0] for t in selected_traits)+'.'
   en+=' Features '+ ' and '.join(t[1] for t in selected_traits)+'.'
  if selected_uses:
   ru+=' Можно выбрать для '+' и '.join(t[0] for t in selected_uses)+'.'
   en+=' A choice for '+' and '.join(t[1] for t in selected_uses)+'.'
  ru=custom.get(name,ru)
  assert ru!=text
  written[pid]=(ru,en)
 item['product']['description'],item['description_en']=written[pid]
data['copyRewrittenAt']='2026-09-29'
path.write_text(json.dumps(data,ensure_ascii=False))
print('Rewrote',len(written),'product descriptions in RU and EN')
