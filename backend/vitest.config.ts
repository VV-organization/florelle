import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgresql://test:test@localhost:5434/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'support@example.com',
      SMTP_PASSWORD: 'smtp-password',
      EMAIL_FROM: 'test@example.com',
      FX_API_KEY: 'test-fx',
      FX_BASE_CURRENCY: 'USD',
      FX_CACHE_TTL_SECONDS: '3600',
      PLATFORM_COMMISSION_PERCENT: '12',
    },
  },
});
