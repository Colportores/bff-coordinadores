import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { iniciales } from "../src/routes/me";
import { get, simularSupabase, supabaseCon, tokenDePrueba, USER_ID } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /v1/me", () => {
  describe("cuando el coordinador tiene perfil", () => {
    it("responde 200 con su id, el nombre para mostrar y las iniciales", async () => {
      supabaseCon({ filasUsuario: [{ nombre: "María", apellido: "Pérez" }] });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        userId: USER_ID,
        nombre: "María Pérez",
        iniciales: "MP",
      });
    });

    it("lee solo su fila de usuario, con su JWT", async () => {
      const llamadas = supabaseCon();
      const token = await tokenDePrueba();
      await get("/v1/me", token);

      const lectura = llamadas[1];
      expect(lectura).toBeDefined();
      const url = new URL(lectura?.url ?? "");
      expect(lectura?.method).toBe("GET");
      expect(url.pathname).toBe("/rest/v1/usuario");
      expect(url.searchParams.get("select")).toBe("nombre,apellido");
      expect(url.searchParams.get("id")).toBe(`eq.${USER_ID}`);
      expect(lectura?.headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(lectura?.headers.get("apikey")).toBe(env.SUPABASE_ANON_KEY);
    });
  });

  describe("cuando el perfil no tiene nombre ni apellido cargados", () => {
    it("responde 200 con nombre e iniciales vacíos", async () => {
      supabaseCon({ filasUsuario: [{ nombre: "", apellido: "" }] });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ nombre: "", iniciales: "" });
    });
  });

  describe("cuando el usuario no tiene fila de perfil", () => {
    it("responde 404", async () => {
      supabaseCon({ filasUsuario: [] });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    });
  });

  describe("cuando Supabase devuelve una forma inesperada", () => {
    it("responde 502 si no es una lista", async () => {
      supabaseCon({ filasUsuario: { nombre: "María" } });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(502);
    });

    it("responde 502 si la fila no trae nombre y apellido", async () => {
      supabaseCon({ filasUsuario: [{ nombre: "María" }] });
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(502);
    });
  });

  describe("cuando falla la lectura del perfil", () => {
    it("responde 502", async () => {
      simularSupabase((req) =>
        new URL(req.url).pathname === "/rest/v1/rpc/tiene_rol"
          ? Response.json(true)
          : new Response("{}", { status: 500 }),
      );
      const res = await get("/v1/me", await tokenDePrueba());

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream_error" });
    });
  });
});

describe("iniciales", () => {
  it("toma la primera letra del nombre y del apellido, en mayúscula", () => {
    expect(iniciales("ángela", " gómez")).toBe("ÁG");
  });

  it("usa solo la que haya si falta una parte", () => {
    expect(iniciales("María", "")).toBe("M");
    expect(iniciales("", "")).toBe("");
  });
});
