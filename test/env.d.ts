/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "cloudflare:test" {
  // `env` en los tests tiene la misma forma que el Env generado por `wrangler types`.
  interface ProvidedEnv extends Env {}
}
