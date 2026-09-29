# Florelle: типографика из референсов

Проверено 28.09.2026 по опубликованным CSS и таблицам символов самих шрифтов. Предыдущие Cormorant Garamond / Onest сняты с сайта после замечания пользователя.

## Используется

| Роль | Гарнитура | Подтверждённый источник |
|---|---|---|
| Заголовки, основной текст, интерфейс | Google Sans, 500 | [Urban Living CSS](https://realevate.agency/style.min.css?v=1789247590000), `--sans-font`, включая крупные `h1` и `.marquee-text` |
| Логотип, крупный бренд в подвале | Owners Wide Medium, 500 | [LxL CSS](https://cdn.prod.website-files.com/69e88d0efafb70caf79fbd65/css/lxl-creative.webflow.shared.9e09a2504.min.css), `@font-face Owners Wide` |
| Русские и английские рукописные акценты во всех основных заголовках | Comforter Brush, 400 | [Uprock: Comforter](https://www.fonts.uprock.ru/fonts/comforter), вариант Comforter Brush, Rob Leuschke, SIL OFL 1.1 |

У Urban Living на сайте опубликован латинский subset Google Sans. Для русского сайта взята полная версия **того же семейства** из [официального каталога Google Fonts](https://github.com/google/fonts/tree/main/ofl/googlesans). Проверены все 64 русские буквы А–я и ё. Шрифт локальный, OFL сохранена рядом с файлом.

По запросу пользователя от 29.09.2026 рукописные приписки переведены на русский. На Uprock визуально сравнены Comforter, Comforter Brush, Miama Nueva, Nickainley, Daneehand и Paddis Handwritten. Выбран **Comforter Brush**: свободный наклонный почерк и шероховатый штрих ближе к Scribo из LxL. Это осознанная кириллическая замена, а не оригинальный Scribo. Проверены А–я и Ё/ё. Используется локальный WOFF2 из архива Uprock; лицензия сохранена рядом.

Owners Wide остаётся только в латинском логотипе. Декоративные приписки «с любовью» и «с заботой» имеют соответствующий язык и скрыты от скринридера; смысловые рукописные слова в заголовках остаются доступными.

## Другие найденные семейства

- Urban Living: также Roslindale Display Light и Monument Extended; опубликованные subsets без кириллицы.
- ERA: Maison Neue Extended Book/Bold; проверенный Book содержит кириллицу. Display-переменная указывает на Ambroise Francois.
- Sobha: TT Commons Pro Medium/DemiBold, TT Ramillas Light; рукописный акцент Altesse Std через Adobe Fonts. Проверенный Commons содержит кириллицу.

Эти семейства не подставлялись вместо выбранных выше.

## Файлы и лицензирование

- `public/fonts/google-sans.ttf`: Google Fonts, OFL в `GoogleSans-OFL.txt`.
- `public/fonts/owners-wide-medium.woff2`: файл из публичного CSS LxL.
- `public/fonts/comforter-brush.woff2`: архив Uprock, OFL в `ComforterBrush-OFL.txt`. Scribo больше не подключается.

Owners Wide — коммерческий шрифт из LxL, используемый в локальном прототипе. Перед публичным размещением нужна собственная webfont-лицензия. Comforter Brush и Google Sans используются по SIL OFL 1.1.
