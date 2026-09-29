# Проверка 28.09.2026

## Сборка и API

- TypeScript и production build Next.js проходят.
- Интеграционные тесты: каталог 1000 уникальных предложений, локальные изображения, розничные и оптовые цены; регистрация и вход, HttpOnly cookie, неверный пароль, запрет чужого Origin, доступ к истории только своего аккаунта, отсутствие доступа у гостя, завершение сессии.
- Сервер отклоняет отрицательное количество, дубли позиций, неверный телефон и вес ниже минимального. Стоимость черновика вычисляется сервером и проверяется тестом.

## Браузер — настольный и 390 × 844

- Обложка переключается между зеленью и цветением; каталог и фотографии отображаются.
- Быстрый просмотр: добавление показывает нижнее уведомление внутри native dialog, основная кнопка меняется на ссылку в корзину. Ссылка закрывает окно и открывает корзину с товаром.
- Повторное добавление заменено переходом; состояние видно в каталоге, быстром просмотре и отдельной странице товара.
- Escape закрывает окно и возвращает фокус на кнопку быстрого просмотра. Закрытие уведомления работает.
- Количество меняет сумму, удаление последнего товара показывает пустую корзину. Перезагрузка сохраняет состав и валюту.
- Мобильный поиск Menta находит двух поставщиков, категория «Пионы» отбирает 9 предложений; фильтры раскрываются и закрываются. Горизонтального переполнения страницы нет.
- Регистрация из оформления возвращает в корзину. Тестовый заказ с получателем, телефоном, адресом и датой сохранён и виден в истории с тем же составом и суммой.
- Оптовая доставка, Стамбул: 100 кг = 2400 TRY, вес 1 кг не даёт допустимого тарифа. Проверен пересчёт в KZT и перевод интерфейса на английский.

Не проверялись реальные платежи, отправка писем и выполнение доставки: соответствующие поставщики не подключены. Снимок каталога не является гарантией текущих остатков.


## 2026-09-29: deployment and botanical motion

- First GitHub Actions run 36519495319 passed: Linux npm ci/build/typecheck, Docker build, live container assets/health and account/order API tests.
- Local standalone production server: health, registration, session, order draft, cross-user isolation and logout passed.
- WebGL compiled in browser without errors; full bloom toggle and keyboard Enter work in both directions. Cursor reveal has an opaque center and feathered perimeter; foliage frames change while heading bounds remain identical.
- Reduced-motion CSS fallback keeps the bloom toggle available; renderer responds to preference changes and pauses outside viewport/hidden tabs.
- Local database files are excluded from Git, Docker context and standalone tracing.
