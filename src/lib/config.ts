/**
 * Falta config del entorno o quedó un placeholder `REEMPLAZAR` de wrangler.jsonc. Es un problema
 * nuestro, no del usuario: nunca se responde como 401, porque el panel lo tomaría como sesión
 * vencida y mandaría a todos a loguearse en loop.
 */
export class ErrorConfig extends Error {
  override readonly name = "ErrorConfig";

  constructor(readonly variable: "SUPABASE_URL" | "SUPABASE_ANON_KEY") {
    super(`config inválida: ${variable}`);
  }
}

const PLACEHOLDER = "REEMPLAZAR";

/** Lanza `ErrorConfig` si `SUPABASE_URL` o `SUPABASE_ANON_KEY` faltan o son un placeholder. */
export function asegurarConfigSupabase(
  env: Partial<Pick<Env, "SUPABASE_URL" | "SUPABASE_ANON_KEY">>,
): void {
  const url: string | undefined = env.SUPABASE_URL;
  if (!url || url.includes(PLACEHOLDER)) throw new ErrorConfig("SUPABASE_URL");
  const clave: string | undefined = env.SUPABASE_ANON_KEY;
  if (!clave || clave.startsWith(PLACEHOLDER)) throw new ErrorConfig("SUPABASE_ANON_KEY");
}
