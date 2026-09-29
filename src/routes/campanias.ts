import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorSupabase, rpc } from "../lib/supabase";
import { esUuid } from "../lib/validacion";
import type { AppEnv } from "../types";

/** Inscripción de un colportor en una campaña, con la forma que consume el panel. */
export interface Inscripcion {
  id: string;
  campaniaId: string;
  usuarioId: string;
  zonaId: string | null;
  metaLibros: number | null;
  creadaEn: string;
}

type TablaDeRechazos = Record<string, { status: ContentfulStatusCode; error: string }>;

interface Rechazo {
  status: ContentfulStatusCode;
  cuerpo: Record<string, unknown>;
}

/**
 * Criterio común de los rechazos de negocio: 404 si el recurso del path no existe, 422 si el del
 * cuerpo no existe o no sirve para esta campaña, 409 si un estado impide la operación. El `mensaje` es
 * el `message` del backend, que es el texto para mostrar.
 */

/** `inscribir_colportor()` (backend-supabase, migración 0005). `CI007` es el literal de HU-CAM-004. */
const RECHAZOS_INSCRIPCION: TablaDeRechazos = {
  CI001: { status: 404, error: "campania_no_encontrada" },
  CI002: { status: 409, error: "campania_no_vigente" },
  CI003: { status: 422, error: "usuario_no_encontrado" },
  CI004: { status: 409, error: "email_sin_verificar" },
  CI005: { status: 409, error: "cuenta_suspendida" },
  CI006: { status: 409, error: "ya_inscripto" },
  CI007: { status: 409, error: "en_otra_campania" },
  CI008: { status: 409, error: "inscripcion_dada_de_baja" },
};

/** `asignar_zona()` (backend-supabase#20). El colportor va en el path; la zona, en el cuerpo. */
const RECHAZOS_ASIGNAR_ZONA: TablaDeRechazos = {
  CZ001: { status: 404, error: "campania_no_encontrada" },
  CZ002: { status: 409, error: "campania_no_vigente" },
  CZ003: { status: 404, error: "colportor_no_inscripto" },
  CZ004: { status: 422, error: "zona_no_encontrada" },
  CZ005: { status: 422, error: "zona_de_otra_ciudad" },
  CZ006: { status: 422, error: "zona_de_otra_campania" },
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
 * Traduce un error de un RPC de campañas a la respuesta del panel. Devuelve `null` si no es un
 * rechazo de negocio: ese error sigue a `app.onError` (401 si es el JWT, 504 si fue timeout, 502 si no).
 */
function rechazoDeNegocio(
  err: ErrorSupabase,
  tabla: TablaDeRechazos,
  mensajeSinPermiso: string,
): Rechazo | null {
  // Con un JWT de usuario, PostgREST responde 42501 con 403: coordinador de otra campaña.
  if (err.status === 403 && err.code === "42501") {
    return {
      status: 403,
      cuerpo: { error: "sin_permiso_en_campania", mensaje: mensajeSinPermiso },
    };
  }

  const rechazo = err.status === 400 && err.code ? tabla[err.code] : undefined;
  if (!rechazo || !err.mensaje) return null;

  const cuerpo: Record<string, unknown> = { error: rechazo.error, mensaje: err.mensaje };
  if (err.code === "CI007") cuerpo.campania = campaniaEnConflicto(err.detalles);
  return { status: rechazo.status, cuerpo };
}

function aInscripcion(fila: unknown, operacion: string): Inscripcion {
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
  throw new ErrorSupabase(200, operacion);
}

function entradaInvalida(c: Context<AppEnv>, campo: string): Response {
  return c.json({ error: "entrada_invalida", detalle: `${campo} tiene que ser un UUID` }, 400);
}

/** Campo `campo` del cuerpo JSON, o `undefined` si el cuerpo no es JSON o no lo trae. */
async function campoDelCuerpo(c: Context<AppEnv>, campo: string): Promise<unknown> {
  const cuerpo: unknown = await c.req.json().catch(() => null);
  return typeof cuerpo === "object" && cuerpo !== null && campo in cuerpo
    ? (cuerpo as Record<string, unknown>)[campo]
    : undefined;
}

/**
 * Llama a un RPC de campañas que devuelve una fila de `campania_colportor` y arma la respuesta:
 * la inscripción con `statusExito`, o el rechazo de negocio traducido.
 */
async function responderInscripcion(
  c: Context<AppEnv>,
  funcion: string,
  args: Record<string, string>,
  tabla: TablaDeRechazos,
  mensajeSinPermiso: string,
  statusExito: 200 | 201,
): Promise<Response> {
  let fila: unknown;
  try {
    fila = await rpc(c.env, c.get("auth").token, funcion, args);
  } catch (err) {
    const rechazo =
      err instanceof ErrorSupabase ? rechazoDeNegocio(err, tabla, mensajeSinPermiso) : null;
    if (!rechazo) throw err;
    return c.json(rechazo.cuerpo, rechazo.status);
  }
  return c.json(aInscripcion(fila, `rpc/${funcion}`), statusExito);
}

/**
 * Rutas de campañas del coordinador. Las reglas las aplica la base; el BFF valida la forma de la
 * entrada (400 `entrada_invalida` sin llamar a Supabase) y traduce los rechazos. Un coordinador de
 * otra campaña recibe 403 `sin_permiso_en_campania`.
 *
 * - `POST /:campaniaId/colportores` con `{ usuarioId }` — HU-CAM-004, añadir colportor a campaña.
 *   Llama a `inscribir_colportor()`: el único camino para inscribir (el INSERT directo da 42501).
 *   201 con la inscripción creada.
 * - `PUT /:campaniaId/colportores/:usuarioId/zona` con `{ zonaId }` — HU-CAM-006, asignar zona.
 *   Llama a `asignar_zona()`: el único camino (el UPDATE directo de `zona_id` da 23514). Reemplaza la
 *   zona anterior; si ya era esa, devuelve la misma inscripción. 200 con la inscripción.
 */
export const campanias = new Hono<AppEnv>()
  .post("/:campaniaId/colportores", async (c) => {
    const campaniaId = c.req.param("campaniaId");
    if (!esUuid(campaniaId)) return entradaInvalida(c, "campaniaId");
    const usuarioId = await campoDelCuerpo(c, "usuarioId");
    if (!esUuid(usuarioId)) return entradaInvalida(c, "usuarioId");

    return responderInscripcion(
      c,
      "inscribir_colportor",
      { p_campania_id: campaniaId, p_usuario_id: usuarioId },
      RECHAZOS_INSCRIPCION,
      "Solo el coordinador de la campaña puede inscribir colportores en ella.",
      201,
    );
  })
  .put("/:campaniaId/colportores/:usuarioId/zona", async (c) => {
    const campaniaId = c.req.param("campaniaId");
    if (!esUuid(campaniaId)) return entradaInvalida(c, "campaniaId");
    const usuarioId = c.req.param("usuarioId");
    if (!esUuid(usuarioId)) return entradaInvalida(c, "usuarioId");
    const zonaId = await campoDelCuerpo(c, "zonaId");
    if (!esUuid(zonaId)) return entradaInvalida(c, "zonaId");

    return responderInscripcion(
      c,
      "asignar_zona",
      { p_campania_id: campaniaId, p_usuario_id: usuarioId, p_zona_id: zonaId },
      RECHAZOS_ASIGNAR_ZONA,
      "Solo el coordinador de la campaña puede asignar zonas en ella.",
      200,
    );
  });
