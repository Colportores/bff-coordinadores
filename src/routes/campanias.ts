import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorSupabase, rpc } from "../lib/supabase";
import { esUuid } from "../lib/validacion";
import type { AppEnv } from "../types";

/** Inscripción creada, con la forma que consume el panel. */
export interface Inscripcion {
  id: string;
  campaniaId: string;
  usuarioId: string;
  zonaId: string | null;
  metaLibros: number | null;
  creadaEn: string;
}

interface Rechazo {
  status: ContentfulStatusCode;
  cuerpo: Record<string, unknown>;
}

/**
 * Rechazos de negocio de `inscribir_colportor()` (backend-supabase, migración 0005): `code` de
 * PostgREST → status y código estable para el panel. El `mensaje` es el `message` del backend, que es
 * el texto para mostrar (`CI007` es el literal de HU-CAM-004: "Está en campaña X. Reasignar primero.").
 */
const RECHAZOS_INSCRIPCION: Record<string, { status: ContentfulStatusCode; error: string }> = {
  CI001: { status: 404, error: "campania_no_encontrada" },
  CI002: { status: 409, error: "campania_no_vigente" },
  CI003: { status: 422, error: "usuario_no_encontrado" },
  CI004: { status: 409, error: "email_sin_verificar" },
  CI005: { status: 409, error: "cuenta_suspendida" },
  CI006: { status: 409, error: "ya_inscripto" },
  CI007: { status: 409, error: "en_otra_campania" },
  CI008: { status: 409, error: "inscripcion_dada_de_baja" },
};

/** `details` de `CI007`: la campaña vigente donde ya está el colportor. */
function campaniaEnConflicto(detalles: unknown): { id: string; nombre: string } | null {
  if (
    typeof detalles === "object" &&
    detalles !== null &&
    "campania_id" in detalles &&
    "campania_nombre" in detalles &&
    typeof detalles.campania_id === "string" &&
    typeof detalles.campania_nombre === "string"
  ) {
    return { id: detalles.campania_id, nombre: detalles.campania_nombre };
  }
  return null;
}

/**
 * Traduce un error de `inscribir_colportor()` a la respuesta del panel. Devuelve `null` si no es un
 * rechazo de negocio: ese error sigue a `app.onError` (401 si es el JWT, 502 si no).
 */
function rechazoDeInscripcion(err: ErrorSupabase): Rechazo | null {
  // Con un JWT de usuario, PostgREST responde 42501 con 403: coordinador de otra campaña.
  if (err.status === 403 && err.code === "42501") {
    return {
      status: 403,
      cuerpo: {
        error: "sin_permiso_en_campania",
        mensaje: "Solo el coordinador de la campaña puede inscribir colportores en ella.",
      },
    };
  }

  const rechazo = err.status === 400 && err.code ? RECHAZOS_INSCRIPCION[err.code] : undefined;
  if (!rechazo || !err.mensaje) return null;

  const cuerpo: Record<string, unknown> = { error: rechazo.error, mensaje: err.mensaje };
  if (err.code === "CI007") cuerpo.campania = campaniaEnConflicto(err.detalles);
  return { status: rechazo.status, cuerpo };
}

function aInscripcion(fila: unknown): Inscripcion {
  if (
    typeof fila === "object" &&
    fila !== null &&
    "id" in fila &&
    "campania_id" in fila &&
    "usuario_id" in fila &&
    "zona_id" in fila &&
    "meta_libros" in fila &&
    "created_at" in fila &&
    typeof fila.id === "string" &&
    typeof fila.campania_id === "string" &&
    typeof fila.usuario_id === "string" &&
    (fila.zona_id === null || typeof fila.zona_id === "string") &&
    (fila.meta_libros === null || typeof fila.meta_libros === "number") &&
    typeof fila.created_at === "string"
  ) {
    return {
      id: fila.id,
      campaniaId: fila.campania_id,
      usuarioId: fila.usuario_id,
      zonaId: fila.zona_id,
      metaLibros: fila.meta_libros,
      creadaEn: fila.created_at,
    };
  }
  throw new ErrorSupabase(200, "rpc/inscribir_colportor");
}

/**
 * Rutas de campañas del coordinador.
 *
 * `POST /v1/campanias/:campaniaId/colportores` con `{ "usuarioId": "<uuid>" }` — HU-CAM-004,
 * añadir colportor a campaña. Llama a `inscribir_colportor()` con el JWT del coordinador: el único
 * camino para inscribir (el INSERT directo da 42501). Las reglas las aplica la base; el BFF valida la
 * forma de la entrada y traduce los rechazos.
 *
 * - 201: la inscripción creada.
 * - 400 `entrada_invalida`: `campaniaId` o `usuarioId` no son UUID, o el cuerpo no es JSON.
 * - 403 `sin_permiso_en_campania`: no coordina esa campaña.
 * - 404/409/422: rechazos de negocio (`RECHAZOS_INSCRIPCION`), con `mensaje` para mostrar.
 */
export const campanias = new Hono<AppEnv>().post("/:campaniaId/colportores", async (c) => {
  const campaniaId = c.req.param("campaniaId");
  if (!esUuid(campaniaId)) {
    return c.json({ error: "entrada_invalida", detalle: "campaniaId tiene que ser un UUID" }, 400);
  }

  const cuerpo: unknown = await c.req.json().catch(() => null);
  const usuarioId =
    typeof cuerpo === "object" && cuerpo !== null && "usuarioId" in cuerpo
      ? cuerpo.usuarioId
      : undefined;
  if (!esUuid(usuarioId)) {
    return c.json({ error: "entrada_invalida", detalle: "usuarioId tiene que ser un UUID" }, 400);
  }

  let fila: unknown;
  try {
    fila = await rpc(c.env, c.get("auth").token, "inscribir_colportor", {
      p_campania_id: campaniaId,
      p_usuario_id: usuarioId,
    });
  } catch (err) {
    const rechazo = err instanceof ErrorSupabase ? rechazoDeInscripcion(err) : null;
    if (!rechazo) throw err;
    return c.json(rechazo.cuerpo, rechazo.status);
  }

  return c.json(aInscripcion(fila), 201);
});
