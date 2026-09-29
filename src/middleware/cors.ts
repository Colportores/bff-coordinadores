import { cors } from "hono/cors";

/** `CORS_ORIGINS` es una lista separada por comas de orígenes exactos (`https://panel.ejemplo`). */
export function origenesPermitidos(lista: string): string[] {
  return lista
    .split(",")
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0);
}

/**
 * CORS para el panel web: solo los orígenes de `CORS_ORIGINS` (wrangler.jsonc → vars, uno por
 * entorno). A un origen que no está en la lista no se le devuelve `Access-Control-Allow-Origin` y el
 * navegador corta. El preflight (`OPTIONS`) responde acá, antes de `requireAuth`.
 */
export const corsPanel = cors({
  origin: (origen, c) => {
    const env: Env = c.env;
    return origenesPermitidos(env.CORS_ORIGINS).includes(origen) ? origen : null;
  },
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
  maxAge: 600,
});
