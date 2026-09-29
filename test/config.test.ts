import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { ErrorConfig } from "../src/lib/config";
import { rpc } from "../src/lib/supabase";
import { simularSupabase, supabaseCon, tokenDePrueba } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Llama al worker con el env de desarrollo pisado por `cambios`. */
async function meCon(cambios: Record<string, unknown>): Promise<Response> {
  const token = await tokenDePrueba();
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("https://bff.test/v1/me", { headers: { Authorization: `Bearer ${token}` } }),
    { ...env, ...cambios },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("config de Supabase", () => {
  describe("cuando está completa", () => {
    it("atiende normalmente", async () => {
      supabaseCon();
      const res = await meCon({});

      expect(res.status).toBe(200);
    });
  });

  // Ninguno de estos casos puede responder 401: el panel desloguearía a todos en loop.
  describe.each([
    ["falta SUPABASE_ANON_KEY", { SUPABASE_ANON_KEY: undefined }],
    ["SUPABASE_ANON_KEY está vacía", { SUPABASE_ANON_KEY: "" }],
    ["SUPABASE_ANON_KEY es un placeholder", { SUPABASE_ANON_KEY: "REEMPLAZAR-anon-key-prod" }],
    ["SUPABASE_URL es un placeholder", { SUPABASE_URL: "https://REEMPLAZAR-prod.supabase.co" }],
    ["falta SUPABASE_URL", { SUPABASE_URL: undefined }],
  ])("cuando %s", (_caso, cambios) => {
    it("responde 503 config_error sin llamar a Supabase", async () => {
      const llamadas = supabaseCon();
      const res = await meCon(cambios);

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "config_error" });
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("cuando el cliente de PostgREST recibe una config inválida", () => {
    it("lanza ErrorConfig sin llamar a fetch", async () => {
      const llamadas = simularSupabase(() => Response.json(true));

      await expect(
        rpc(
          {
            SUPABASE_URL: env.SUPABASE_URL,
            SUPABASE_ANON_KEY: "" as string as Env["SUPABASE_ANON_KEY"],
          },
          "jwt",
          "tiene_rol",
          {},
        ),
      ).rejects.toBeInstanceOf(ErrorConfig);
      expect(llamadas).toHaveLength(0);
    });
  });
});
