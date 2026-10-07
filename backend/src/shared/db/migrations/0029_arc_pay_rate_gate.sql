CREATE TABLE arc_pay_rate_limits (
 scope text PRIMARY KEY,
 blocked_until timestamptz NOT NULL DEFAULT now(),
 next_request_at timestamptz NOT NULL DEFAULT now()
);
