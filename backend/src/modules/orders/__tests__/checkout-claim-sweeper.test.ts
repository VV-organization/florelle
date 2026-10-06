import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CheckoutClaimSweeper,
  installCheckoutClaimSweeper,
} from '../checkout-claim-sweeper';
import type { OrdersService } from '../orders.service';

function createService() {
  return {
    recoverStaleCheckoutClaims: vi.fn().mockResolvedValue({
      recoveredClaims: 0,
      failedClaims: [],
    }),
  } as unknown as OrdersService & {
    recoverStaleCheckoutClaims: ReturnType<typeof vi.fn>;
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CheckoutClaimSweeper', () => {
  it('logs each isolated stale-claim recovery failure', async () => {
    vi.useFakeTimers();
    const service = createService();
    service.recoverStaleCheckoutClaims.mockResolvedValueOnce({
      recoveredClaims: 1,
      failedClaims: [{
        cartId: 'cart-corrupt',
        merchantOrderId: 'FL-20260713-CORRUPT',
        errorCode: 'CHECKOUT_CLAIM_INVARIANT',
      }],
    });
    const logger = createLogger();
    const sweeper = new CheckoutClaimSweeper(service, logger, {
      intervalMs: 1_000,
      batchSize: 10,
    });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.info).toHaveBeenCalledWith(
      { recoveredClaims: 1 },
      'recovered stale checkout claims',
    );
    expect(logger.error).toHaveBeenCalledWith(
      {
        cartId: 'cart-corrupt',
        merchantOrderId: 'FL-20260713-CORRUPT',
        errorCode: 'CHECKOUT_CLAIM_INVARIANT',
      },
      'failed to recover stale checkout claim',
    );

    await sweeper.stop();
  });

  it('runs immediately, repeats on schedule, and stops cleanly', async () => {
    vi.useFakeTimers();
    const service = createService();
    service.recoverStaleCheckoutClaims.mockResolvedValue({
      recoveredClaims: 2,
      failedClaims: [],
    });
    const logger = createLogger();
    const sweeper = new CheckoutClaimSweeper(service, logger, {
      intervalMs: 1_000,
      batchSize: 10,
    });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.recoverStaleCheckoutClaims).toHaveBeenCalledWith(10);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.recoverStaleCheckoutClaims).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      { recoveredClaims: 2 },
      'recovered stale checkout claims',
    );

    await sweeper.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.recoverStaleCheckoutClaims).toHaveBeenCalledTimes(2);
  });

  it('does not overlap sweeps and logs recoverable failures', async () => {
    vi.useFakeTimers();
    let resolveSweep!: (result: {
      recoveredClaims: number;
      failedClaims: never[];
    }) => void;
    const service = createService();
    service.recoverStaleCheckoutClaims.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSweep = resolve;
      }),
    );
    const logger = createLogger();
    const sweeper = new CheckoutClaimSweeper(service, logger, {
      intervalMs: 1_000,
      batchSize: 10,
    });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.recoverStaleCheckoutClaims).toHaveBeenCalledTimes(1);

    resolveSweep({ recoveredClaims: 0, failedClaims: [] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.recoverStaleCheckoutClaims).toHaveBeenCalledTimes(2);

    service.recoverStaleCheckoutClaims.mockRejectedValueOnce(new Error('db unavailable'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'failed to recover stale checkout claims',
    );

    await sweeper.stop();
  });

  it('registers startup and shutdown with the application lifecycle', async () => {
    vi.useFakeTimers();
    const service = createService();
    const logger = createLogger();
    const hooks = new Map<string, () => void | Promise<void>>();
    const app = {
      log: logger,
      addHook: vi.fn((name: string, hook: () => void | Promise<void>) => {
        hooks.set(name, hook);
      }),
    };

    installCheckoutClaimSweeper(app, service, {
      intervalMs: 1_000,
      batchSize: 10,
    });

    await hooks.get('onReady')?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.recoverStaleCheckoutClaims).toHaveBeenCalledOnce();

    await hooks.get('onClose')?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.recoverStaleCheckoutClaims).toHaveBeenCalledOnce();
  });
});
