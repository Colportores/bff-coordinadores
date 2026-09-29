import { createMiddleware } from "hono/factory";
import { log } from "../lib/log";
import { rpc } from "../lib/supabase";
import type { AppEnv } from "../types";

/**
 * Middleware Hono: exige que el usuario autenticado tenga el rol de negocio `COORDINADOR` vigente.
 * Va después de `requireAuth`.
 *
 * El rol lo decide la base con `public.tiene_rol('COORDINADOR')` (backend-supabase, migración
 * 0001), llamada con el JWT del propio usuario: tiene en cuenta `valido_desde`/`valido_hasta` y las
 * bajas (`deleted_at` del usuario, del rol y de la asignación). Nunca se lee de un claim del token ni
 * de nada que mande el cliente: un claim quedaría vigente hasta que el JWT expire aunque el rol se
 * haya revocado. Un usuario con varios roles pasa si uno de ellos es `COORDINADOR`.
 *
 * Si Supabase falla, `rpc` lanza `ErrorSupabase` y responde `app.onError`.
 */
export const requireCoordinador = createMiddleware<AppEnv>(async (c, next) => {
  const { userId, token } = c.get("auth");

  const esCoordinador = await rpc(c.env, token, "tiene_rol", { p_codigo: "COORDINADOR" });
  if (esCoordinador !== true) {
    log.warn("AUTH", "SIN_ROL_COORDINADOR", "usuario sin rol COORDINADOR vigente", {
      user_id: userId,
    });
    return c.json(
      { error: "forbidden", detalle: "el usuario no tiene el rol coordinador vigente" },
      403,
    );
  }

  await next();
});
