import { sql } from 'drizzle-orm';
import { orders } from '../../shared/db/schema/orders';
import { checkoutAttempts } from '../../shared/db/schema/checkout';
import { payments } from '../../shared/db/schema/payments';

// A cancelled order can still require review after a late capture or mismatch.
// Use the same authoritative cleanup predicate for admission and scenario reuse.
export const syntheticNeedsResolution = sql`(
  ${orders.status} <> 'cancelled' OR NOT EXISTS (
    SELECT 1 FROM ${checkoutAttempts}
    INNER JOIN ${payments} ON ${payments.orderId} = ${checkoutAttempts.orderId}
    WHERE ${checkoutAttempts.orderId} = ${orders.id}
      AND ${checkoutAttempts.state} = 'failed'
      AND ${checkoutAttempts.reviewReason} IS NULL
      AND ${payments.status} = 'failed'
  )
)`;
