import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { origenesPermitidos } from "../src/middleware/cors";
import { supabaseCon } from "./helpers";

// CORS_ORIGINS de desarrollo en wrangler.jsonc.
const PANEL_LOCAL = "http://localhost:3000";

afterEach(() => {
  vi.restoreAllMocks();
});

function preflight(origen: string): Promise<Response> {
  return SELF.fetch("https://bff.test/v1/me", {
    method: "OPTIONS",
    headers: {
      Origin: origen,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
}

describe("CORS", () => {
  describe("cuando el preflight viene del panel configurado", () => {
    it("lo acepta sin pedir JWT ni consultar Supabase", async () => {
      const llamadas = supabaseCon();
      const res = await preflight(PANEL_LOCAL);

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PANEL_LOCAL);
      expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain(
        "authorization",
      );
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando el preflight viene de otro origen", () => {
    it("no devuelve Access-Control-Allow-Origin", async () => {
      const res = await preflight("https://sitio-ajeno.test");

      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("cuando una request común viene del panel configurado", () => {
    it("devuelve Access-Control-Allow-Origin", async () => {
      const res = await SELF.fetch("https://bff.test/health", {
        headers: { Origin: PANEL_LOCAL },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PANEL_LOCAL);
    });
  });
});

describe("origenesPermitidos", () => {
  it("separa por comas e ignora espacios y entradas vacías", () => {
    expect(origenesPermitidos(" https://a.test ,https://b.test,, ")).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });
});
