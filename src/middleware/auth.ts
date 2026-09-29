import { createMiddleware } from "hono/factory";
import {
  createRemoteJWKSet,
  errors,
  type JWTPayload,
  type JWTVerifyOptions,
  jwtVerify,
} from "jose";
import { log } from "../lib/log";
import type { AppEnv } from "../types";

/** Lo que el resto del BFF sabe del usuario autenticado. Sin PII: solo el UUID, los claims y el token. */
export interface AuthContext {
  /** `sub` del JWT — coincide con `auth.users.id` y `public.usuario.id`. */
  userId: string;
  /** Rol de Postgres que Supabase asigna al JWT (`authenticated`). Los roles de negocio viven en `usuario_rol`. */
  role: string;
  claims: JWTPayload;
  /**
   * El JWT tal cual llegó, para reenviarlo a Supabase (ADR-013). Nunca se loguea ni se persiste.
   */
  token: string;
}

type ClavesVerificacion = Pick<Env, "SUPABASE_URL"> & Partial<Pick<Env, "SUPABASE_JWT_SECRET">>;

// Cache por URL del JWKS: es configuración, no estado de request (el set se comparte entre requests
// del mismo isolate, que es exactamente lo que queremos para no re-descargar las claves).
const jwksPorUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksDe(url: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksPorUrl.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    jwksPorUrl.set(url, set);
  }
  return set;
}

/**
 * Verifica un JWT emitido por Supabase Auth. Mismo verificador que `bff-colportores`.
 *
 * - Con `SUPABASE_JWT_SECRET` definido (proyectos legacy con firma simétrica) valida HS256.
 * - Si no, valida contra el JWKS público del proyecto (claves asimétricas, default actual).
 *
 * Solo verifica firma, emisor, audiencia y expiración. El rol de negocio lo decide la base
 * (`requireCoordinador`), nunca un claim del token.
 */
export async function verificarJwtSupabase(
  token: string,
  env: ClavesVerificacion,
): Promise<JWTPayload> {
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  const opciones: JWTVerifyOptions = {
    issuer,
    audience: "authenticated",
    requiredClaims: ["exp", "sub"],
  };

  if (env.SUPABASE_JWT_SECRET) {
    const clave = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(token, clave, { ...opciones, algorithms: ["HS256"] });
    return payload;
  }

  const { payload } = await jwtVerify(token, jwksDe(`${issuer}/.well-known/jwks.json`), opciones);
  return payload;
}

/**
 * Errores de jose que dicen "este token no sirve": corresponden a 401. Cualquier otro (el fetch del
 * JWKS que falla, `JWKSTimeout`, `JWKSInvalid`, un JWKS que no responde 200) es infraestructura:
 * responderlo como 401 desloguearía a todos durante una caída de Supabase Auth.
 */
const ERRORES_DE_TOKEN = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWSSignatureVerificationFailed,
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWKSNoMatchingKey,
  // Token sin `kid` frente a un JWKS de varias claves: lo arma quien manda el token, no es infra.
  errors.JWKSMultipleMatchingKeys,
];

export function esErrorDeToken(err: unknown): boolean {
  return ERRORES_DE_TOKEN.some((clase) => err instanceof clase);
}

function extraerBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [esquema, token] = header.split(" ");
  if (esquema?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Middleware Hono: exige `Authorization: Bearer <jwt>` válido y deja `c.get("auth")` disponible. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = extraerBearer(c.req.header("Authorization"));
  if (!token) {
    return c.json({ error: "unauthorized", detalle: "falta Authorization: Bearer <jwt>" }, 401);
  }

  try {
    const claims = await verificarJwtSupabase(token, c.env);
    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      log.warn("AUTH", "JWT_SIN_SUB", "token válido pero sin sub");
      return c.json({ error: "unauthorized" }, 401);
    }
    const role = typeof claims.role === "string" ? claims.role : "authenticated";
    c.set("auth", { userId: claims.sub, role, claims, token });
  } catch (err) {
    const motivo = err instanceof Error ? err.name : "desconocido";
    if (esErrorDeToken(err)) {
      log.warn("AUTH", "JWT_INVALID", "token rechazado", { motivo });
      return c.json({ error: "unauthorized" }, 401);
    }
    log.error("AUTH", "JWT_VERIFICACION_FALLO", "no se pudo verificar el token (JWKS o red)", {
      motivo,
    });
    return c.json({ error: "upstream_error" }, 502);
  }

  await next();
});
