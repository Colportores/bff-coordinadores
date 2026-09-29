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

/** Lo que se rescata del cuerpo de error de PostgREST (`{code, message, details, hint}`). */
export interface CuerpoDeError {
  code: string | null;
  /** `message` del error. Solo lo usan las rutas para los rechazos de negocio conocidos; nunca se loguea. */
  mensaje: string | null;
  /** `details` parseado como JSON si se puede, o el string tal cual. Nunca se loguea. */
  detalles: unknown;
}

const SIN_CUERPO: CuerpoDeError = { code: null, mensaje: null, detalles: null };

/**
 * Supabase respondió con error, con un cuerpo que no es JSON, o no respondió.
 * `status` es el HTTP de PostgREST (0 si no hubo respuesta) y `code`, el `code` de su cuerpo de error.
 */
export class ErrorSupabase extends Error {
  override readonly name = "ErrorSupabase";
  readonly code: string | null;
  readonly mensaje: string | null;
  readonly detalles: unknown;

  constructor(
    readonly status: number,
    readonly operacion: string,
    cuerpo: CuerpoDeError = SIN_CUERPO,
  ) {
    super(`Supabase respondió ${status} en ${operacion}`);
    this.code = cuerpo.code;
    this.mensaje = cuerpo.mensaje;
    this.detalles = cuerpo.detalles;
  }

  /** PostgREST rechazó el JWT del usuario: corresponde 401. Cualquier otra falla es 502. */
  get jwtRechazado(): boolean {
    return this.status === 401 && esCodigoDeJwt(this.code);
  }
}

function comoJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

async function cuerpoDeError(res: Response): Promise<CuerpoDeError> {
  const cuerpo: unknown = await res.json().catch(() => null);
  if (typeof cuerpo !== "object" || cuerpo === null) return SIN_CUERPO;
  const code = "code" in cuerpo && typeof cuerpo.code === "string" ? cuerpo.code : null;
  const mensaje = "message" in cuerpo && typeof cuerpo.message === "string" ? cuerpo.message : null;
  const detalles =
    "details" in cuerpo && typeof cuerpo.details === "string" ? comoJson(cuerpo.details) : null;
  return { code, mensaje, detalles };
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
    throw new ErrorSupabase(res.status, operacion, await cuerpoDeError(res));
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
