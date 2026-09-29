import { Hono } from "hono";
import { log } from "./lib/log";
import { ErrorSupabase } from "./lib/supabase";
import { requireAuth } from "./middleware/auth";
import { requireCoordinador } from "./middleware/coordinador";
import { corsPanel } from "./middleware/cors";
import { health } from "./routes/health";
import { me } from "./routes/me";
import type { AppEnv } from "./types";

/**
 * bff-coordinadores — adaptador sin estado entre el panel web de coordinadores y Supabase
 * (ADR-013: un BFF por aplicación en Workers).
 *
 * Reglas del repo:
 * - Valida el JWT y lo reenvía; la autoridad de permisos es la RLS.
 * - Sin lógica de dominio: vive en RPCs de Postgres.
 * - Sin PII: no se persiste, no se cachea, no se loguea (Ley 18.331).
 *
 * Rutas:
 *   GET /health   público
 *   GET /v1/*     JWT de Supabase Auth + rol COORDINADOR vigente
 *   GET /v1/me    perfil del coordinador para el topbar del panel
 */
const app = new Hono<AppEnv>();

app.use("*", corsPanel);

app.route("/health", health);

app.use("/v1/*", requireAuth, requireCoordinador);
app.route("/v1/me", me);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  if (err instanceof ErrorSupabase) {
    // PostgREST rechazó el JWT que este BFF ya había validado: se trata como sesión inválida.
    if (err.status === 401) {
      log.warn("AUTH", "JWT_RECHAZADO_POR_SUPABASE", "Supabase rechazó el token", {
        operacion: err.operacion,
      });
      return c.json({ error: "unauthorized" }, 401);
    }
    log.error("NET", "SUPABASE_ERROR", "Supabase no respondió como se esperaba", {
      operacion: err.operacion,
      status: err.status,
    });
    return c.json({ error: "upstream_error" }, 502);
  }

  log.error("NET", "UNHANDLED", "error no controlado", {
    metodo: c.req.method,
    path: new URL(c.req.url).pathname,
    error: err.message,
  });
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
