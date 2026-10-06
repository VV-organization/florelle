import { randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import type { FxService } from '../../shared/currency/fx.service';
import { balanceTopUps, balanceTransactions } from '../../shared/db/schema/balance';
import type {
  BalanceTopUp,
  BalanceTransaction,
} from '../../shared/db/schema/balance';
import { users } from '../../shared/db/schema/users';
import { addMoney, multiplyMoney } from '../../shared/money/money';
import { NotFoundError } from '../../shared/middleware/error.middleware';
import type { PaymentProvider } from '../payments/payment-provider';
import type { CreateTopUpBody } from './balance.schema';
import {
  InvalidTopUpStatusError,
  TopUpForbiddenError,
  TopUpNotFoundError,
  TopUpPaymentCreationFailedError,
} from './balance.errors';

export type BalanceServiceConfig = { callbackUrl: string };

export type ParsedPaymentCallback = {
  merchantOrderId: string;
  externalId: string;
  status: 'paid' | 'failed' | 'pending';
};

type TopUpStatus = BalanceTopUp['status'];
type BalanceTransactionType = BalanceTransaction['type'];

export type TopUpResponse = {
  id: string;
  status: TopUpStatus;
  amountUsd: string;
  amountRub: string;
  fxRate: string;
  merchantOrderId: string;
  paymentUrl: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type BalanceTransactionResponse = {
  id: string;
  type: BalanceTransactionType;
  amountUsd: string;
  balanceAfterUsd: string;
  topUpId: string | null;
  orderId: string | null;
  createdAt: string;
};

export class BalanceService {
  constructor(
    private readonly db: Database,
    private readonly fxService: FxService,
    private readonly paymentProvider: PaymentProvider,
    private readonly config: BalanceServiceConfig,
  ) {}

  async getBalance(userId: string): Promise<{ balanceUsd: string }> {
    const rows = await this.db
      .select({ balanceUsd: users.balanceUsd })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return { balanceUsd: user.balanceUsd };
  }

  async listTopUps(userId: string): Promise<{ data: TopUpResponse[] }> {
    const rows = await this.db
      .select()
      .from(balanceTopUps)
      .where(eq(balanceTopUps.userId, userId))
      .orderBy(desc(balanceTopUps.createdAt));

    return { data: rows.map((row) => this.mapTopUp(row)) };
  }

  async listTransactions(
    userId: string,
  ): Promise<{ data: BalanceTransactionResponse[] }> {
    const rows = await this.db
      .select()
      .from(balanceTransactions)
      .where(eq(balanceTransactions.userId, userId))
      .orderBy(desc(balanceTransactions.createdAt));

    return { data: rows.map((row) => this.mapTransaction(row)) };
  }

  async createTopUp(
    userId: string,
    input: CreateTopUpBody,
  ): Promise<{ topUp: TopUpResponse; paymentUrl: string }> {
    const userRows = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = userRows[0];
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const rate = await this.fxService.getRate('RUB');
    const merchantOrderId = this.generateMerchantOrderId();
    const amountRub = multiplyMoney(input.amountUsd, rate);
    const buyerEmail = input.buyerEmail ?? user.email;

    const inserted = await this.db
      .insert(balanceTopUps)
      .values({
        userId,
        merchantOrderId,
        amountUsd: input.amountUsd,
        amountRub,
        fxRate: rate.toFixed(6),
        buyerEmail,
        buyerPhone: input.buyerPhone,
        status: 'pending',
      })
      .returning();

    const topUp = inserted[0]!;

    try {
      const payment = await this.paymentProvider.createPayment({
        merchantOrderId: topUp.merchantOrderId,
        amountUsd: input.amountUsd,
        description: `Balance top-up ${topUp.merchantOrderId}`,
        buyerEmail,
        buyerPhone: input.buyerPhone,
        callbackUrl: this.config.callbackUrl,
      });

      const updated = await this.db
        .update(balanceTopUps)
        .set({
          arcopayOrderId: payment.externalId,
          paymentUrl: payment.paymentUrl,
          updatedAt: new Date(),
        })
        .where(eq(balanceTopUps.id, topUp.id))
        .returning();

      const paidTopUp = updated[0] ?? {
        ...topUp,
        arcopayOrderId: payment.externalId,
        paymentUrl: payment.paymentUrl,
      };

      return {
        topUp: this.mapTopUp(paidTopUp),
        paymentUrl: payment.paymentUrl,
      };
    } catch {
      await this.db
        .update(balanceTopUps)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(balanceTopUps.id, topUp.id));
      throw new TopUpPaymentCreationFailedError();
    }
  }

  async getTopUpPaymentUrl(
    topUpId: string,
    userId: string,
  ): Promise<{ topUp: TopUpResponse; paymentUrl: string }> {
    const topUp = await this.getOwnedTopUp(topUpId, userId);
    this.assertPayable(topUp);

    if (!topUp.arcopayOrderId) {
      throw new InvalidTopUpStatusError('Top-up payment has not been initiated');
    }

    if (topUp.paymentUrl) {
      return { topUp: this.mapTopUp(topUp), paymentUrl: topUp.paymentUrl };
    }

    const refreshed = await this.paymentProvider.getPaymentUrl({
      externalId: topUp.arcopayOrderId,
      description: `Balance top-up ${topUp.merchantOrderId}`,
      buyerPhone: topUp.buyerPhone ?? undefined,
    });

    const updated = await this.db
      .update(balanceTopUps)
      .set({ paymentUrl: refreshed.paymentUrl, updatedAt: new Date() })
      .where(eq(balanceTopUps.id, topUp.id))
      .returning();

    const refreshedTopUp = updated[0] ?? {
      ...topUp,
      paymentUrl: refreshed.paymentUrl,
    };

    return {
      topUp: this.mapTopUp(refreshedTopUp),
      paymentUrl: refreshed.paymentUrl,
    };
  }

  async cancelTopUp(
    topUpId: string,
    userId: string,
  ): Promise<{ topUp: TopUpResponse }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(balanceTopUps)
        .where(eq(balanceTopUps.id, topUpId))
        .for('update');

      const topUp = rows[0];
      if (!topUp) {
        throw new TopUpNotFoundError();
      }
      if (topUp.userId !== userId) {
        throw new TopUpForbiddenError();
      }
      this.assertPayable(topUp);

      const updated = await tx
        .update(balanceTopUps)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(balanceTopUps.id, topUp.id))
        .returning();

      return {
        topUp: this.mapTopUp(updated[0] ?? { ...topUp, status: 'cancelled' }),
      };
    });
  }

  async processTopUpCallback(
    payload: ParsedPaymentCallback,
  ): Promise<{ handled: boolean; reason?: string }> {
    return this.db.transaction(async (tx) => {
      const topUpRows = await tx
        .select()
        .from(balanceTopUps)
        .where(eq(balanceTopUps.merchantOrderId, payload.merchantOrderId))
        .for('update');

      const topUp = topUpRows[0];
      if (!topUp) {
        return { handled: false };
      }

      if (topUp.status === 'completed') {
        return { handled: true, reason: 'top_up_already_completed' };
      }

      if (topUp.status !== 'pending') {
        return { handled: true, reason: 'top_up_not_pending' };
      }

      if (payload.status === 'failed') {
        await tx
          .update(balanceTopUps)
          .set({
            status: 'failed',
            arcopayOrderId: payload.externalId,
            updatedAt: new Date(),
          })
          .where(eq(balanceTopUps.id, topUp.id));
        return { handled: true, reason: 'top_up_failed' };
      }

      if (payload.status === 'pending') {
        await tx
          .update(balanceTopUps)
          .set({
            ...(topUp.arcopayOrderId ? {} : { arcopayOrderId: payload.externalId }),
            updatedAt: new Date(),
          })
          .where(eq(balanceTopUps.id, topUp.id));
        return { handled: true, reason: 'top_up_pending' };
      }

      const userRows = await tx
        .select({ id: users.id, balanceUsd: users.balanceUsd })
        .from(users)
        .where(eq(users.id, topUp.userId))
        .for('update');

      const user = userRows[0];
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const balanceAfterUsd = addMoney(user.balanceUsd, topUp.amountUsd);
      const completedAt = new Date();

      await tx
        .update(users)
        .set({ balanceUsd: balanceAfterUsd, updatedAt: completedAt })
        .where(eq(users.id, topUp.userId));

      await tx
        .update(balanceTopUps)
        .set({
          status: 'completed',
          arcopayOrderId: payload.externalId,
          paidAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(balanceTopUps.id, topUp.id))
        .returning();

      await tx
        .insert(balanceTransactions)
        .values({
          userId: topUp.userId,
          type: 'top_up',
          amountUsd: topUp.amountUsd,
          balanceAfterUsd,
          topUpId: topUp.id,
        });

      return { handled: true, reason: 'top_up_completed' };
    });
  }

  private async getOwnedTopUp(topUpId: string, userId: string): Promise<BalanceTopUp> {
    const rows = await this.db
      .select()
      .from(balanceTopUps)
      .where(eq(balanceTopUps.id, topUpId))
      .limit(1);

    const topUp = rows[0];
    if (!topUp) {
      throw new TopUpNotFoundError();
    }
    if (topUp.userId !== userId) {
      throw new TopUpForbiddenError();
    }

    return topUp;
  }

  private assertPayable(topUp: BalanceTopUp): void {
    if (topUp.status !== 'pending') {
      throw new InvalidTopUpStatusError();
    }
  }

  private mapTopUp(topUp: BalanceTopUp): TopUpResponse {
    return {
      id: topUp.id,
      status: topUp.status,
      amountUsd: topUp.amountUsd,
      amountRub: topUp.amountRub,
      fxRate: topUp.fxRate,
      merchantOrderId: topUp.merchantOrderId,
      paymentUrl: topUp.paymentUrl,
      createdAt: topUp.createdAt.toISOString(),
      paidAt: topUp.paidAt ? topUp.paidAt.toISOString() : null,
    };
  }

  private mapTransaction(
    transaction: BalanceTransaction,
  ): BalanceTransactionResponse {
    return {
      id: transaction.id,
      type: transaction.type,
      amountUsd: transaction.amountUsd,
      balanceAfterUsd: transaction.balanceAfterUsd,
      topUpId: transaction.topUpId,
      orderId: transaction.orderId,
      createdAt: transaction.createdAt.toISOString(),
    };
  }

  private generateMerchantOrderId(): string {
    const date = new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const suffix = randomBytes(4)
      .toString('base64url')
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase()
      .slice(0, 6)
      .padEnd(6, '0');

    return `TU-${year}${month}${day}-${suffix}`;
  }
}
