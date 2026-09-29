import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /health", () => {
  describe("cuando el worker está arriba", () => {
    it("responde 200 con el nombre del servicio y el entorno", async () => {
      const res = await SELF.fetch("https://bff.test/health");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: "ok",
        servicio: "bff-coordinadores",
        entorno: "development",
      });
    });
  });

  describe("cuando la ruta no existe", () => {
    it("responde 404 con error not_found", async () => {
      const res = await SELF.fetch("https://bff.test/no-existe");

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });
});
