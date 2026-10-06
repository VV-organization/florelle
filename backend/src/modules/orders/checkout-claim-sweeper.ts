import type { OrdersService } from './orders.service';

export type CheckoutClaimSweeperOptions = {
  intervalMs: number;
  batchSize: number;
};

type SweepLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

type LifecycleApp = {
  log: SweepLogger;
  addHook(
    name: 'onReady' | 'onClose',
    hook: () => void | Promise<void>,
  ): void;
};

export class CheckoutClaimSweeper {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly logger: SweepLogger,
    private readonly options: CheckoutClaimSweeperOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    this.trigger();
    this.timer = setInterval(() => this.trigger(), this.options.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.running;
  }

  private trigger(): void {
    if (this.running) return;

    const run = this.runOnce();
    this.running = run;
    void run.finally(() => {
      if (this.running === run) {
        this.running = undefined;
      }
    });
  }

  private async runOnce(): Promise<void> {
    try {
      const { recoveredClaims, failedClaims } =
        await this.ordersService.recoverStaleCheckoutClaims(
          this.options.batchSize,
        );
      if (recoveredClaims > 0) {
        this.logger.info(
          { recoveredClaims },
          'recovered stale checkout claims',
        );
      }
      for (const failure of failedClaims) {
        this.logger.error(failure, 'failed to recover stale checkout claim');
      }
    } catch (err) {
      this.logger.error(
        { err },
        'failed to recover stale checkout claims',
      );
    }
  }
}

export function installCheckoutClaimSweeper(
  app: LifecycleApp,
  ordersService: OrdersService,
  options: CheckoutClaimSweeperOptions,
): void {
  const sweeper = new CheckoutClaimSweeper(ordersService, app.log, options);
  app.addHook('onReady', () => sweeper.start());
  app.addHook('onClose', () => sweeper.stop());
}
