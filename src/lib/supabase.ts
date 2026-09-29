import { asegurarConfigSupabase } from "./config";

/**
 * Cliente mínimo de PostgREST para el BFF.
 *
 * Cada llamada reenvía el JWT del usuario tal cual (ADR-013): Postgres ve `auth.uid()` del
 * coordinador y la RLS decide qué puede leer. El BFF nunca usa la service key.
 *
 * Los errores se lanzan como `ErrorSupabase` o `ErrorConfig` y los traduce `app.onError`
 * (src/index.ts); las rutas no los atrapan.
 */

type ConfigSupabase = Pick<Env, "SUPABASE_URL" | "SUPABASE_ANON_KEY">;

/**
 * `code` de PostgREST que significan "el JWT del usuario no sirve": PGRST3xx (JWT inválido,
 * vencido, sin claims) y 42501 (sin permiso con ese rol). Un 401 sin uno de estos lo devuelve el
 * gateway por una API key inválida: es config nuestra, no del usuario.
 */
function esCodigoDeJwt(code: string | null): boolean {
  return code !== null && (/^PGRST3\d\d$/.test(code) || code === "42501");
}

/**
 * Supabase respondió con error, con un cuerpo que no es JSON, o no respondió.
 * `status` es el HTTP de PostgREST (0 si no hubo respuesta) y `code`, el `code` de su cuerpo de error.
 */
export class ErrorSupabase extends Error {
  override readonly name = "ErrorSupabase";

  constructor(
    readonly status: number,
    readonly operacion: string,
    readonly code: string | null = null,
  ) {
    super(`Supabase respondió ${status} en ${operacion}`);
  }

  /** PostgREST rechazó el JWT del usuario: corresponde 401. Cualquier otra falla es 502. */
  get jwtRechazado(): boolean {
    return this.status === 401 && esCodigoDeJwt(this.code);
  }
}

/** Solo el `code` del cuerpo de error de PostgREST; el resto no se guarda ni se loguea. */
async function codigoDeError(res: Response): Promise<string | null> {
  const cuerpo: unknown = await res.json().catch(() => null);
  if (typeof cuerpo === "object" && cuerpo !== null && "code" in cuerpo) {
    return typeof cuerpo.code === "string" ? cuerpo.code : null;
  }
  return null;
}

async function llamar(
  env: ConfigSupabase,
  jwt: string,
  ruta: string,
  init: RequestInit,
  operacion: string,
): Promise<unknown> {
  asegurarConfigSupabase(env);

  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/${ruta}`, {
      ...init,
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  } catch {
    throw new ErrorSupabase(0, operacion);
  }

  if (!res.ok) {
    throw new ErrorSupabase(res.status, operacion, await codigoDeError(res));
  }

  try {
    return await res.json();
  } catch {
    throw new ErrorSupabase(res.status, operacion);
  }
}

/** `POST /rest/v1/rpc/<funcion>` con el JWT del usuario. Devuelve el JSON sin validar. */
export function rpc(
  env: ConfigSupabase,
  jwt: string,
  funcion: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return llamar(
    env,
    jwt,
    `rpc/${funcion}`,
    { method: "POST", body: JSON.stringify(args) },
    `rpc/${funcion}`,
  );
}

/**
 * `GET /rest/v1/<tabla>?<parametros>` con el JWT del usuario. Los parámetros van en la sintaxis
 * de PostgREST (`select`, `id=eq.<uuid>`…) y se codifican acá.
 */
export function seleccionar(
  env: ConfigSupabase,
  jwt: string,
  tabla: string,
  parametros: Record<string, string>,
): Promise<unknown> {
  const query = new URLSearchParams(parametros).toString();
  return llamar(env, jwt, `${tabla}?${query}`, { method: "GET" }, `select/${tabla}`);
}
