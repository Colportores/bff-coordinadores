import { Hono } from "hono";
import { log } from "./lib/log";
import { health } from "./routes/health";
import type { AppEnv } from "./types";

/**
 * bff-coordinadores — adaptador sin estado entre el panel web de coordinadores y Supabase
 * (ADR-013: un BFF por aplicación en Workers).
 *
 * Rutas:
 *   GET /health   público
 */
const app = new Hono<AppEnv>();

app.route("/health", health);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
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
