import nodemailer, { type Transporter } from 'nodemailer';

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
};

export type MailTransport = Pick<Transporter, 'sendMail'>;

export type MailSendResult = {
  messageId?: string;
};

export type SendRegistrationCodeInput = {
  to: string;
  code: string;
  expiresAt: Date;
  idempotencyKey: string;
};

export type SendOrderPaidInput = {
  to: string;
  orderId: string;
  totalUsd: string;
  amountRub?: string;
  paidAt: Date;
  idempotencyKey: string;
};

export class NotificationsService {
  private readonly transport: MailTransport;

  constructor(
    private readonly from: string,
    transportOrConfig: MailTransport | SmtpConfig,
  ) {
    this.transport =
      'sendMail' in transportOrConfig
        ? transportOrConfig
        : nodemailer.createTransport(transportOrConfig);
  }

  async sendRegistrationCode(input: SendRegistrationCodeInput): Promise<void> {
    const message = renderRegistrationCodeEmail({
      code: input.code,
      expiresAt: input.expiresAt,
    });
    const result = (await this.transport.sendMail({
      from: this.from,
      to: input.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        'X-Entity-Ref-ID': input.idempotencyKey,
      },
    })) as MailSendResult;
    if (!result.messageId) {
      throw new Error('SMTP_SEND_REJECTED');
    }
  }

  async sendOrderPaid(input: SendOrderPaidInput): Promise<void> {
    const message = renderOrderPaidEmail({
      orderId: input.orderId,
      totalUsd: input.totalUsd,
      amountRub: input.amountRub,
      paidAt: input.paidAt,
    });
    const result = (await this.transport.sendMail({
      messageId: `<order-paid.${input.orderId.replace(/[^a-zA-Z0-9-]/g, "")}@florelle>`,
      from: this.from,
      to: input.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        'X-Entity-Ref-ID': input.idempotencyKey,
      },
    })) as MailSendResult;
    if (!result.messageId) {
      throw new Error('SMTP_SEND_REJECTED');
    }
  }
}

export function renderRegistrationCodeEmail(input: {
  code: string;
  expiresAt: Date;
}): RenderedEmail {
  const code = escapeHtml(input.code);
  const expiresAt = formatEmailExpiration(input.expiresAt);
  return {
    subject: 'Код подтверждения регистрации — Florelle',
    text: [
      'Здравствуйте!',
      '',
      'Благодарим за регистрацию в Florelle.',
      '',
      `Код подтверждения: ${input.code}`,
      '',
      `Код действителен до ${expiresAt}.`,
      '',
      'Если вы не регистрировались в Florelle, просто проигнорируйте это письмо.',
      '',
      'С уважением,',
      'Команда Florelle',
    ].join('\n'),
    html: emailHtml(
      `<p>Здравствуйте!</p><p>Благодарим за регистрацию в Florelle.</p><p>Введите этот код, чтобы подтвердить email:</p><p style="font-size:24px;font-weight:700;letter-spacing:3px;padding:16px;background:#f0f5ea;border-radius:8px">${code}</p><p>Код действителен до ${escapeHtml(expiresAt)}.</p><p>Если вы не регистрировались в Florelle, просто проигнорируйте это письмо.</p>`,
    ),
  };
}

export function renderOrderPaidEmail(input: {
  orderId: string;
  totalUsd: string;
  amountRub?: string;
  paidAt: Date;
}): RenderedEmail {
  const orderId = escapeHtml(input.orderId);
  const total = input.amountRub ? `${input.amountRub} ₽` : `$${input.totalUsd}`;
  const paidAt = formatEmailExpiration(input.paidAt);
  return {
    subject: 'Оплата заказа принята — Florelle',
    text: [
      'Здравствуйте!',
      '',
      'Спасибо за заказ.',
      '',
      `Номер заказа: ${input.orderId}`,
      `Сумма заказа: ${total}`,
      `Оплата получена: ${paidAt}.`,
      '',
      'Мы приняли оплату и передали заказ в обработку.',
      '',
      'С уважением,',
      'Команда Florelle',
    ].join('\n'),
    html: emailHtml(
      `<p>Здравствуйте!</p><p>Спасибо за заказ.</p><p><strong>Номер заказа:</strong> ${orderId}<br><strong>Сумма заказа:</strong> ${escapeHtml(total)}<br><strong>Оплата получена:</strong> ${escapeHtml(paidAt)}.</p><p>Мы приняли оплату и передали заказ в обработку.</p>`,
    ),
  };
}

function formatEmailExpiration(date: Date): string {
  return `${formatEmailDateTime(date)} МСК`;
}

function formatEmailDateTime(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function emailHtml(content: string): string {
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f6f7fb;color:#18212f;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:12px"><div style="font-size:24px;font-weight:700;margin-bottom:24px">Florelle</div>${content}<p style="margin-top:28px">С уважением,<br><strong>Команда Florelle</strong></p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}
