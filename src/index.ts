import { Hono } from "hono";
import { ErrorConfig } from "./lib/config";
import { log } from "./lib/log";
import { ErrorSupabase } from "./lib/supabase";
import { requireAuth } from "./middleware/auth";
import { requireConfig } from "./middleware/config";
import { requireCoordinador } from "./middleware/coordinador";
import { corsPanel } from "./middleware/cors";
import { campanias } from "./routes/campanias";
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
 *   POST /v1/campanias/:campaniaId/colportores   inscribir un colportor (HU-CAM-004)
 *   PUT  /v1/campanias/:campaniaId/colportores/:usuarioId/zona   asignar zona (HU-CAM-006)
 */
const app = new Hono<AppEnv>();

app.use("*", corsPanel);

app.route("/health", health);

app.use("/v1/*", requireConfig, requireAuth, requireCoordinador);
app.route("/v1/me", me);
app.route("/v1/campanias", campanias);

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Solo es 401 lo que dice que el token del usuario no sirve. Config faltante o Supabase caído nunca
// son 401: el panel lo tomaría como sesión vencida y mandaría a todos a loguearse en loop.
app.onError((err, c) => {
  if (err instanceof ErrorConfig) {
    log.error("NET", "CONFIG_INVALIDA", "falta config de Supabase o quedó un placeholder", {
      variable: err.variable,
    });
    return c.json({ error: "config_error" }, 503);
  }

  if (err instanceof ErrorSupabase) {
    // PostgREST rechazó el JWT (PGRST3xx o 42501) que este BFF ya había validado.
    if (err.jwtRechazado) {
      log.warn("AUTH", "JWT_RECHAZADO_POR_SUPABASE", "Supabase rechazó el token", {
        operacion: err.operacion,
        code: err.code,
      });
      return c.json({ error: "unauthorized" }, 401);
    }
    if (err.timeout) {
      log.error("NET", "SUPABASE_TIMEOUT", "Supabase no respondió a tiempo", {
        operacion: err.operacion,
      });
      return c.json({ error: "upstream_timeout" }, 504);
    }
    log.error("NET", "SUPABASE_ERROR", "Supabase no respondió como se esperaba", {
      operacion: err.operacion,
      status: err.status,
      code: err.code,
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
