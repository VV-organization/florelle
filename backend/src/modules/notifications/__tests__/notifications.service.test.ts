import { describe, expect, it, vi } from 'vitest';
import {
  NotificationsService,
  renderOrderPaidEmail,
  renderRegistrationCodeEmail,
  type MailTransport,
} from '../notifications.service';

describe('NotificationsService', () => {
  it('renders the registration code email in text and escaped HTML', () => {
    const message = renderRegistrationCodeEmail({
      code: '123<56',
      expiresAt: new Date('2026-08-21T15:00:45.112Z'),
    });

    expect(message.subject).toBe('Код подтверждения регистрации — Florelle');
    expect(message.text).toContain('Код подтверждения: 123<56');
    expect(message.text).toContain('Код действителен до 21.08.2026, 18:00 МСК.');
    expect(message.text).not.toContain('2026-08-21T15:00:45.112Z');
    expect(message.html).toContain('123&lt;56');
    expect(message.html).toContain('Код действителен до 21.08.2026, 18:00 МСК.');
    expect(message.html).not.toContain('2026-08-21T15:00:45.112Z');
    expect(message.html).toContain('Florelle');
  });

  it('sends a registration code through SMTP transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'smtp-123' });
    const transport = { sendMail } as unknown as MailTransport;
    const service = new NotificationsService('Florelle <support@example.com>', transport);

    await service.sendRegistrationCode({
      to: 'buyer@example.com',
      code: '123456',
      expiresAt: new Date('2026-04-10T10:10:00.000Z'),
      idempotencyKey: 'registration-code/challenge_1',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Florelle <support@example.com>',
        to: 'buyer@example.com',
        subject: 'Код подтверждения регистрации — Florelle',
        text: expect.stringContaining('Код подтверждения: 123456'),
        html: expect.stringContaining('123456'),
        headers: {
          'X-Entity-Ref-ID': 'registration-code/challenge_1',
        },
      }),
    );
  });

  it('renders the paid order email in text and escaped HTML', () => {
    const message = renderOrderPaidEmail({
      orderId: 'order-123<',
      totalUsd: '120.50',
      paidAt: new Date('2026-08-21T15:00:45.112Z'),
    });

    expect(message.subject).toBe('Оплата заказа принята — Florelle');
    expect(message.text).toContain('Спасибо за заказ.');
    expect(message.text).toContain('Номер заказа: order-123<');
    expect(message.text).toContain('Сумма заказа: $120.50');
    expect(message.text).toContain('Оплата получена: 21.08.2026, 18:00 МСК.');
    expect(message.html).toContain('order-123&lt;');
    expect(message.html).toContain('$120.50');
  });

  it('sends a paid order email through SMTP transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'smtp-order-123' });
    const transport = { sendMail } as unknown as MailTransport;
    const service = new NotificationsService('Florelle <support@example.com>', transport);

    await service.sendOrderPaid({
      to: 'buyer@example.com',
      orderId: 'order-123',
      totalUsd: '120.50',
      paidAt: new Date('2026-08-21T15:00:45.112Z'),
      idempotencyKey: 'order-paid/order-123',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Florelle <support@example.com>',
        to: 'buyer@example.com',
        subject: 'Оплата заказа принята — Florelle',
        text: expect.stringContaining('Номер заказа: order-123'),
        html: expect.stringContaining('order-123'),
        headers: {
          'X-Entity-Ref-ID': 'order-paid/order-123',
        },
      }),
    );
  });
});

it('uses the persisted RUB amount and a stable SMTP Message-ID for Arc orders',async()=>{
 const sendMail=vi.fn().mockResolvedValue({messageId:'accepted'});
 const service=new NotificationsService('support@example.com',{sendMail} as unknown as MailTransport);
 await service.sendOrderPaid({to:'buyer@example.test',orderId:'arc-order',totalUsd:'18.86',amountRub:'1885.63',paidAt:new Date(),idempotencyKey:'order-paid/arc-order'});
 expect(sendMail.mock.calls[0]?.[0]).toMatchObject({text:expect.stringContaining('1885.63 ₽'),messageId:'<order-paid.arc-order@florelle>'});
});
