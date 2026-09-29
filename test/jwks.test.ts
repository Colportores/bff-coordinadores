import { env } from "cloudflare:test";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "../src/middleware/auth";
import type { AppEnv } from "../src/types";
import { USER_ID } from "./helpers";

// vitest.config.ts fuerza HS256 en el worker con SUPABASE_JWT_SECRET. La rama JWKS (la de
// producción) se prueba montando `requireAuth` en una app chica con el secreto vacío.
const app = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", (c) => c.json({ userId: c.get("auth").userId }));

const KID = "clave-1";
let contador = 0;

interface Escenario {
  url: string;
  privada: CryptoKey;
  jwks: { keys: unknown[] };
}

/** Proyecto ficticio con su par de claves ES256. URL distinta por test: jose cachea el JWKS por URL. */
async function proyecto(): Promise<Escenario> {
  contador += 1;
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "ES256", use: "sig" };
  return { url: `http://proyecto-${contador}.test`, privada: privateKey, jwks: { keys: [jwk] } };
}

function firmar(p: Escenario, clave: CryptoKey = p.privada, kid = KID): Promise<string> {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(`${p.url}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(USER_ID)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(clave);
}

/** Sirve el JWKS del proyecto con lo que devuelva `respuesta`; cualquier otro fetch pasa de largo. */
function servirJwks(p: Escenario, respuesta: () => Response): void {
  const original = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (req.url === `${p.url}/auth/v1/.well-known/jwks.json`) return respuesta();
    return original(input, init);
  });
}

async function pedir(p: Escenario, token: string): Promise<Response> {
  return await app.request(
    "/",
    { headers: { Authorization: `Bearer ${token}` } },
    { ...env, SUPABASE_URL: p.url, SUPABASE_JWT_SECRET: "" },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requireAuth con JWKS (sin SUPABASE_JWT_SECRET)", () => {
  describe("cuando el token está firmado con la clave publicada", () => {
    it("lo acepta", async () => {
      const p = await proyecto();
      servirJwks(p, () => Response.json(p.jwks));
      const res = await pedir(p, await firmar(p));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ userId: USER_ID });
    });
  });

  describe("cuando el token está firmado con otra clave y el mismo kid", () => {
    it("responde 401", async () => {
      const p = await proyecto();
      const otra = await generateKeyPair("ES256");
      servirJwks(p, () => Response.json(p.jwks));
      const res = await pedir(p, await firmar(p, otra.privateKey));

      expect(res.status).toBe(401);
    });
  });

  describe("cuando el kid no está en el JWKS", () => {
    it("responde 401", async () => {
      const p = await proyecto();
      servirJwks(p, () => Response.json(p.jwks));
      const res = await pedir(p, await firmar(p, p.privada, "kid-desconocido"));

      expect(res.status).toBe(401);
    });
  });

  describe("cuando el JWKS tiene 2 claves y el token no trae kid", () => {
    it("responde 401, no 502", async () => {
      const p = await proyecto();
      const segunda = await generateKeyPair("ES256");
      p.jwks.keys.push({
        ...(await exportJWK(segunda.publicKey)),
        kid: "clave-2",
        alg: "ES256",
        use: "sig",
      });
      const ajena = await generateKeyPair("ES256");
      servirJwks(p, () => Response.json(p.jwks));
      const token = await new SignJWT({ role: "authenticated" })
        .setProtectedHeader({ alg: "ES256", typ: "JWT" })
        .setIssuer(`${p.url}/auth/v1`)
        .setAudience("authenticated")
        .setSubject(USER_ID)
        .setExpirationTime("1h")
        .sign(ajena.privateKey);
      const res = await pedir(p, token);

      expect(res.status).toBe(401);
    });
  });

  describe("cuando el token es HS256", () => {
    it("responde 401", async () => {
      const p = await proyecto();
      servirJwks(p, () => Response.json(p.jwks));
      const token = await new SignJWT({ role: "authenticated" })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(`${p.url}/auth/v1`)
        .setAudience("authenticated")
        .setSubject(USER_ID)
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("cualquier-secreto-de-32-bytes-o-mas-xxxxxx"));
      const res = await pedir(p, token);

      expect(res.status).toBe(401);
    });
  });

  describe("cuando Supabase Auth no responde", () => {
    it("responde 502, no 401", async () => {
      const p = await proyecto();
      servirJwks(p, () => {
        throw new TypeError("fetch failed");
      });
      const res = await pedir(p, await firmar(p));

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream_error" });
    });
  });

  describe("cuando el JWKS responde con error", () => {
    it("responde 502", async () => {
      const p = await proyecto();
      servirJwks(p, () => new Response("caído", { status: 503 }));
      const res = await pedir(p, await firmar(p));

      expect(res.status).toBe(502);
    });
  });

  describe("cuando el JWKS no tiene forma de JWKS", () => {
    it("responde 502", async () => {
      const p = await proyecto();
      servirJwks(p, () => Response.json({ claves: [] }));
      const res = await pedir(p, await firmar(p));

      expect(res.status).toBe(502);
    });
  });
});
