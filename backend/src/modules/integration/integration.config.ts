import type { Env } from '../../shared/env';

export type IntegrationConfig = {
  adminToken: string | undefined;
  protocolSecret: string | undefined;
  siteDomain: string;
  dispatch: {
    enabled: boolean;
    status: 'ok' | 'not_configured';
  };
};

type IntegrationEnvironment = Pick<
  Env,
  | 'FLOWER_POINT_INTEGRATION_TOKEN'
  | 'VV_ADMIN_WEBHOOK_URL'
  | 'VV_ADMIN_WEBHOOK_SITE_KEY'
  | 'VV_ADMIN_WEBHOOK_SECRET'
  | 'VV_ADMIN_WEBHOOK_SECRET_VERSION'
  | 'VV_ADMIN_INTEGRATION_SECRET'
  | 'PUBLIC_FRONTEND_URL'
> & {
  FLORELLE_INTEGRATION_TOKEN?: string;
  VV_ADMIN_INTEGRATION_ENABLED?: boolean | 'true' | 'false';
};

export function buildIntegrationConfig(
  environment: IntegrationEnvironment,
): IntegrationConfig {
  const dispatchEnabled =
    (environment.VV_ADMIN_INTEGRATION_ENABLED === true ||
      environment.VV_ADMIN_INTEGRATION_ENABLED === 'true') &&
    Boolean(
      environment.VV_ADMIN_WEBHOOK_URL &&
        environment.VV_ADMIN_WEBHOOK_SITE_KEY &&
        environment.VV_ADMIN_WEBHOOK_SECRET &&
        environment.VV_ADMIN_WEBHOOK_SECRET_VERSION,
    );

  return {
    adminToken: environment.FLORELLE_INTEGRATION_TOKEN ?? environment.FLOWER_POINT_INTEGRATION_TOKEN,
    protocolSecret: environment.VV_ADMIN_INTEGRATION_SECRET,
    siteDomain: siteDomainFromPublicUrl(environment.PUBLIC_FRONTEND_URL),
    dispatch: {
      enabled: dispatchEnabled,
      status: dispatchEnabled ? 'ok' : 'not_configured',
    },
  };
}

function siteDomainFromPublicUrl(publicFrontendUrl: string | undefined): string {
  if (!publicFrontendUrl) return 'florelle.local';

  return new URL(publicFrontendUrl).hostname || 'florelle.local';
}
