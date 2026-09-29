import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { get, simularSupabase, supabaseCon, tokenDePrueba } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autenticación de /v1/*", () => {
  describe("cuando no hay header Authorization", () => {
    it("responde 401 sin consultar Supabase", async () => {
      const llamadas = supabaseCon();
      const res = await get("/v1/me");

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando el header no es Bearer", () => {
    it("responde 401", async () => {
      const llamadas = supabaseCon();
      const res = await SELF.fetch("https://bff.test/v1/me", {
        headers: { Authorization: "Basic abc" },
      });

      expect(res.status).toBe(401);
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando el token está firmado con otra clave", () => {
    it("responde 401", async () => {
      const llamadas = supabaseCon();
      const token = await tokenDePrueba({
        secreto: "otra-clave-que-no-es-la-del-proyecto-xxxxxxxx",
      });
      const res = await get("/v1/me", token);

      expect(res.status).toBe(401);
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando el token expiró", () => {
    it("responde 401", async () => {
      const llamadas = supabaseCon();
      const token = await tokenDePrueba({ expiracion: Math.floor(Date.now() / 1000) - 60 });
      const res = await get("/v1/me", token);

      expect(res.status).toBe(401);
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando el emisor no es el proyecto Supabase configurado", () => {
    it("responde 401", async () => {
      const llamadas = supabaseCon();
      const token = await tokenDePrueba({ issuer: "https://otro.supabase.co/auth/v1" });
      const res = await get("/v1/me", token);

      expect(res.status).toBe(401);
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando la audiencia no es authenticated", () => {
    it("responde 401", async () => {
      const llamadas = supabaseCon();
      const token = await tokenDePrueba({ audience: "anon" });
      const res = await get("/v1/me", token);

      expect(res.status).toBe(401);
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando el token no trae sub", () => {
    it("responde 401", async () => {
      const llamadas = supabaseCon();
      const token = await tokenDePrueba({ sub: null });
      const res = await get("/v1/me", token);

      expect(res.status).toBe(401);
      expect(llamadas).toHaveLength(0);
    });
  });
});

describe("rol coordinador en /v1/*", () => {
  describe("cuando el usuario no tiene el rol COORDINADOR vigente", () => {
    it("responde 403", async () => {
      supabaseCon({ esCoordinador: false });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "forbidden" });
    });
  });

  describe("cuando el token trae un rol inventado por el cliente", () => {
    it("lo ignora y responde 403 si la base dice que no es coordinador", async () => {
      supabaseCon({ esCoordinador: false });
      const token = await tokenDePrueba({
        claims: {
          rol: "coordinador",
          user_role: "COORDINADOR",
          app_metadata: { roles: ["COORDINADOR"] },
          user_metadata: { rol: "COORDINADOR" },
        },
      });
      const res = await SELF.fetch("https://bff.test/v1/me", {
        headers: { Authorization: `Bearer ${token}`, "X-Rol": "COORDINADOR" },
      });

      expect(res.status).toBe(403);
    });
  });

  describe("cuando tiene_rol devuelve algo que no es true", () => {
    it("responde 403", async () => {
      supabaseCon({ esCoordinador: "true" });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(403);
    });
  });

  describe("cuando consulta el rol", () => {
    it("llama a tiene_rol('COORDINADOR') reenviando el JWT del usuario y la clave anon", async () => {
      const llamadas = supabaseCon();
      const token = await tokenDePrueba();
      await get("/v1/me", token);

      const consultaRol = llamadas[0];
      expect(consultaRol).toBeDefined();
      expect(consultaRol?.method).toBe("POST");
      expect(consultaRol?.url).toBe(`${env.SUPABASE_URL}/rest/v1/rpc/tiene_rol`);
      expect(consultaRol?.headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(consultaRol?.headers.get("apikey")).toBe(env.SUPABASE_ANON_KEY);
      expect(JSON.parse(consultaRol?.cuerpo ?? "null")).toEqual({ p_codigo: "COORDINADOR" });
    });
  });

  describe("cuando Supabase rechaza el token", () => {
    it("responde 401", async () => {
      simularSupabase(() => new Response("{}", { status: 401 }));
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });
  });

  describe("cuando Supabase responde con error", () => {
    it("responde 502", async () => {
      simularSupabase(() => new Response("{}", { status: 503 }));
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream_error" });
    });
  });

  describe("cuando Supabase no responde", () => {
    it("responde 502", async () => {
      simularSupabase(() => {
        throw new TypeError("fetch failed");
      });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(502);
    });
  });

  describe("cuando Supabase responde algo que no es JSON", () => {
    it("responde 502", async () => {
      simularSupabase(() => new Response("<html>", { status: 200 }));
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(502);
    });
  });
});
