/**
 * Cliente mínimo de PostgREST para el BFF.
 *
 * Cada llamada reenvía el JWT del usuario tal cual (ADR-013): Postgres ve `auth.uid()` del
 * coordinador y la RLS decide qué puede leer. El BFF nunca usa la service key.
 *
 * Los errores se lanzan como `ErrorSupabase` y los traduce `app.onError` (src/index.ts); las rutas
 * no los atrapan.
 */

type ConfigSupabase = Pick<Env, "SUPABASE_URL" | "SUPABASE_ANON_KEY">;

/**
 * Supabase respondió con error, con un cuerpo que no es JSON, o no respondió.
 * `status` es el HTTP de PostgREST, o 0 si no hubo respuesta.
 */
export class ErrorSupabase extends Error {
  override readonly name = "ErrorSupabase";

  constructor(
    readonly status: number,
    readonly operacion: string,
  ) {
    super(`Supabase respondió ${status} en ${operacion}`);
  }
}

async function llamar(
  env: ConfigSupabase,
  jwt: string,
  ruta: string,
  init: RequestInit,
  operacion: string,
): Promise<unknown> {
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
    // El cuerpo del error no se lee: podría traer datos de la fila y acá no entra nada al log.
    await res.body?.cancel();
    throw new ErrorSupabase(res.status, operacion);
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
