import { createMiddleware } from "hono/factory";
import { asegurarConfigSupabase } from "../lib/config";
import type { AppEnv } from "../types";

/**
 * Middleware Hono: corta con `ErrorConfig` (→ 503 `config_error` en `app.onError`) si la config de
 * Supabase falta o es un placeholder. Va antes de `requireAuth`: con `SUPABASE_URL` sin completar,
 * el emisor esperado del JWT no coincidiría y todos los tokens darían 401.
 */
export const requireConfig = createMiddleware<AppEnv>(async (c, next) => {
  asegurarConfigSupabase(c.env);
  await next();
});
