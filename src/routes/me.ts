import { Hono } from "hono";
import { ErrorSupabase, seleccionar } from "../lib/supabase";
import type { AppEnv } from "../types";

interface FilaUsuario {
  nombre: string;
  apellido: string;
}

/** Primera fila de `public.usuario`, o `null` si no hay. Una forma inesperada es error de Supabase. */
function primeraFila(filas: unknown): FilaUsuario | null {
  if (!Array.isArray(filas)) throw new ErrorSupabase(200, "select/usuario");
  const fila: unknown = filas[0];
  if (fila === undefined) return null;
  if (
    typeof fila !== "object" ||
    fila === null ||
    !("nombre" in fila) ||
    !("apellido" in fila) ||
    typeof fila.nombre !== "string" ||
    typeof fila.apellido !== "string"
  ) {
    throw new ErrorSupabase(200, "select/usuario");
  }
  return { nombre: fila.nombre, apellido: fila.apellido };
}

/** Primera letra del nombre y del apellido, en mayúscula ("María", "pérez" → "MP"). */
export function iniciales(nombre: string, apellido: string): string {
  return [nombre, apellido]
    .map((parte) => Array.from(parte.trim())[0] ?? "")
    .join("")
    .toLocaleUpperCase("es");
}

/**
 * `GET /v1/me` — perfil del coordinador autenticado, para el topbar del panel
 * (`ResumenCoordinador` en front-coordinadores-web, src/datos/shell/contrato.ts).
 *
 * Lee `public.usuario` con el JWT del coordinador (la RLS `usuario_select_propio_o_staff` le deja
 * leer su fila). Devuelve lo que el esquema resuelve sin ambigüedad: el nombre para mostrar y las
 * iniciales. `region` y `campania` del contrato quedan pendientes de definición
 * (front-coordinadores-web#18).
 */
export const me = new Hono<AppEnv>().get("/", async (c) => {
  const { userId, token } = c.get("auth");

  const filas = await seleccionar(c.env, token, "usuario", {
    select: "nombre,apellido",
    id: `eq.${userId}`,
  });
  const perfil = primeraFila(filas);
  if (!perfil) {
    return c.json({ error: "not_found", detalle: "el usuario no tiene perfil" }, 404);
  }

  const nombre = [perfil.nombre, perfil.apellido]
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0)
    .join(" ");

  return c.json({
    userId,
    nombre,
    iniciales: iniciales(perfil.nombre, perfil.apellido),
  });
});
