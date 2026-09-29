/**
 * Tipado del entorno Hono. `Env` lo genera `wrangler types` a partir de wrangler.jsonc y
 * .dev.vars — nunca escribirlo a mano (ver .claude/skills/workers-best-practices).
 */
export type AppEnv = {
  Bindings: Env;
};
