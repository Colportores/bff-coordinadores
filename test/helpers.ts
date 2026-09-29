import { env, SELF } from "cloudflare:test";
import { type JWTPayload, SignJWT } from "jose";
import { vi } from "vitest";

export const USER_ID = "01920000-0000-7000-8000-000000000001"; // UUID v7 de prueba

export interface OpcionesToken {
  secreto?: string;
  issuer?: string;
  audience?: string;
  expiracion?: string | number;
  sub?: string | null;
  /** Claims extra, p. ej. un rol inventado por el cliente. */
  claims?: JWTPayload;
}

export async function tokenDePrueba(opts: OpcionesToken = {}): Promise<string> {
  const clave = new TextEncoder().encode(opts.secreto ?? env.SUPABASE_JWT_SECRET);
  const jwt = new SignJWT({ role: "authenticated", ...opts.claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(opts.issuer ?? `${env.SUPABASE_URL}/auth/v1`)
    .setAudience(opts.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.expiracion ?? "1h");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? USER_ID);
  return jwt.sign(clave);
}

export function get(path: string, token?: string): Promise<Response> {
  return SELF.fetch(`https://bff.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

type Manejador = (req: Request) => Response | Promise<Response>;

/** Copia de una request del worker a Supabase. El cuerpo se lee adentro del worker: workerd no deja leer un stream de otro contexto de I/O. */
export interface LlamadaSupabase {
  method: string;
  url: string;
  headers: Headers;
  cuerpo: string | null;
  /** El `signal` que pasó el worker al fetch (el timeout de `llamar`). */
  signal: AbortSignal | null;
}

/**
 * Intercepta las llamadas del worker a Supabase (mismo isolate que los tests) y devuelve la lista
 * de requests que llegaron, para inspeccionarlas. Cualquier otro fetch pasa de largo.
 * Se deshace con `vi.restoreAllMocks()`.
 */
export function simularSupabase(manejador: Manejador): LlamadaSupabase[] {
  const original = globalThis.fetch;
  const origen = new URL(env.SUPABASE_URL).origin;
  const llamadas: LlamadaSupabase[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (new URL(req.url).origin !== origen) return original(input, init);
    llamadas.push({
      method: req.method,
      url: req.url,
      headers: new Headers(req.headers),
      cuerpo: req.body ? await req.clone().text() : null,
      signal: init?.signal ?? null,
    });
    return manejador(req);
  });
  return llamadas;
}

export interface EscenarioSupabase {
  /** Lo que devuelve `rpc/tiene_rol`. */
  esCoordinador?: unknown;
  /** Filas que devuelve `GET /rest/v1/usuario`. */
  filasUsuario?: unknown;
}

/** Supabase sano: responde `tiene_rol` y `usuario` con lo que diga el escenario. */
export function supabaseCon(escenario: EscenarioSupabase = {}): LlamadaSupabase[] {
  const { esCoordinador = true, filasUsuario = [{ nombre: "María", apellido: "Pérez" }] } =
    escenario;
  return simularSupabase((req) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/rest/v1/rpc/tiene_rol") return Response.json(esCoordinador);
    if (pathname === "/rest/v1/usuario") return Response.json(filasUsuario);
    return new Response("ruta no simulada", { status: 500 });
  });
}
