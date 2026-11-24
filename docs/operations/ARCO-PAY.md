# Arco Pay / Clickit, общий магазин 1581

Florelle / Bloom-send использует `PAYMENT_PROVIDER=arcopay`, API
`https://api.clickit.team/api/v1` и форму `https://payment.paidlayer.com/{OrderId}`.
Нужны серверные ARCOPAY_API_KEY, ARCOPAY_BEARER_TOKEN, ARCOPAY_PUBLIC_KEY,
ARCOPAY_SHOP_ID=1581, PUBLIC_API_URL и PUBLIC_FRONTEND_URL.
Callback: `https://bloom-send.com/api/v1/payments/callback`.
Секреты не входят в репозиторий и frontend. Старый Arc Pay не используется
как резервный провайдер; существующая история не переносится между провайдерами.

CREATE: PaymentTypes=["IPS"] (только СБП), PayIn, IsForm=true, LifeTime=900, сумма из сохранённого RUB-снимка,
UUID попытки как x-req-id. Форма открывается POST с successUrl/failUrl на страницу
заказа. Форма регистрирует QR для оплаты через СБП.

Подпись Payment-Sign проверяется RSA-SHA1 по исходным байтам. Callback служит
поводом запросить /payments/status. Проверяются магазин, OrderId,
MerchantOrderId, сумма и RUB. IPS_ACCEPTED подтверждает оплату через СБП, CHARGED поддерживается для ранее созданных карточных платежей;
при переданном PaymentType он должен соответствовать статусу. Промежуточные
статусы не оплачивают и не отменяют заказ. Обновление заказа, платежа,
остатков и события VV Admin выполняется транзакционно, дубли не повторяют выдачу.

Известные неоплаченные OrderId проверяются фоновым опросом и перед повторным
переходом к оплате. При неизвестном результате CREATE попытка остаётся review;
новый платёж автоматически не создаётся. Проверенный callback может восстановить
OrderId, потерянный при сетевом сбое. Расчёт цен, сегменты B2B/B2C и доставка сохранены.

Проверки с PostgreSQL выполняются только локально на отдельной florelle_test:
`TEST_DATABASE_URL=... pnpm test` из backend/. CI запускает unit-тесты,
проверку типов и сборку без создания тестовой базы.
