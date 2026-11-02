export interface Config {
  port: number;
  databaseUrl: string;
  rabbitUrl: string | undefined;
  jwtSecret: string;
  catalogApiUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3004),
    databaseUrl: env.DATABASE_URL ?? 'postgres://orders:orders@localhost:5432/orders',
    rabbitUrl: env.RABBITMQ_URL,
    jwtSecret: env.JWT_SECRET ?? 'dev-only-secret',
    catalogApiUrl: env.CATALOG_API_URL ?? 'http://localhost:3002',
  };
}
