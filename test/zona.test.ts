import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LlamadaSupabase, simularSupabase, tokenDePrueba, USER_ID } from "./helpers";

const CAMPANIA_ID = "01920000-0000-7000-8000-0000000000c1";
const COLPORTOR_ID = "01920000-0000-7000-8000-0000000000a1";
const ZONA_ID = "01920000-0000-7000-8000-0000000000e1";
const RUTA = `/v1/campanias/${CAMPANIA_ID}/colportores/${COLPORTOR_ID}/zona`;
const RPC = "/rest/v1/rpc/asignar_zona";

const FILA = {
  id: "01920000-0000-7000-8000-0000000000f1",
  campania_id: CAMPANIA_ID,
  usuario_id: COLPORTOR_ID,
  zona_id: ZONA_ID,
  meta_libros: 40,
  created_at: "2026-09-29T12:00:00+00:00",
  updated_at: "2026-09-29T13:00:00+00:00",
  created_by: USER_ID,
  deleted_at: null,
  sync_version: 2,
};

const SIN_PERMISO = "Solo el coordinador de la campaña puede asignar zonas en ella.";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Supabase con el coordinador habilitado; `asignar` responde lo que diga el test. */
function supabaseAsigna(asignar: () => Response, esCoordinador = true): LlamadaSupabase[] {
  return simularSupabase((req) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/rest/v1/rpc/tiene_rol") return Response.json(esCoordinador);
    if (pathname === RPC) return asignar();
    return new Response("ruta no simulada", { status: 500 });
  });
}

function errorPostgrest(status: number, code: string, message: string) {
  return () => Response.json({ code, message, details: null, hint: null }, { status });
}

async function asignar(
  cuerpo: unknown = { zonaId: ZONA_ID },
  ruta = RUTA,
  token?: string,
): Promise<Response> {
  return SELF.fetch(`https://bff.test${ruta}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token ?? (await tokenDePrueba())}`,
      "Content-Type": "application/json",
    },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

function llamadasAlRpc(llamadas: LlamadaSupabase[]): LlamadaSupabase[] {
  return llamadas.filter((l) => new URL(l.url).pathname === RPC);
}

describe("PUT /v1/campanias/:campaniaId/colportores/:usuarioId/zona", () => {
  describe("cuando la zona se asigna", () => {
    it("responde 200 con la inscripción y su zona", async () => {
      supabaseAsigna(() => Response.json(FILA));
      const res = await asignar();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: FILA.id,
        campaniaId: CAMPANIA_ID,
        usuarioId: COLPORTOR_ID,
        zonaId: ZONA_ID,
        metaLibros: 40,
        creadaEn: FILA.created_at,
      });
    });

    it("llama a asignar_zona con el JWT del coordinador y los tres ids", async () => {
      const llamadas = supabaseAsigna(() => Response.json(FILA));
      const token = await tokenDePrueba();
      await asignar(undefined, RUTA, token);

      const [llamada] = llamadasAlRpc(llamadas);
      expect(llamada?.method).toBe("POST");
      expect(llamada?.headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(llamada?.headers.get("apikey")).toBe(env.SUPABASE_ANON_KEY);
      expect(llamada?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(llamada?.cuerpo ?? "null")).toEqual({
        p_campania_id: CAMPANIA_ID,
        p_usuario_id: COLPORTOR_ID,
        p_zona_id: ZONA_ID,
      });
    });

    it("si ya tenía esa zona, responde 200 con la misma inscripción", async () => {
      supabaseAsigna(() => Response.json(FILA));
      const primera = await asignar();
      const segunda = await asignar();

      expect(segunda.status).toBe(200);
      expect(await segunda.json()).toEqual(await primera.json());
    });
  });

  describe("cuando la entrada no es válida", () => {
    it.each([
      [
        "campaniaId no es UUID",
        { zonaId: ZONA_ID },
        `/v1/campanias/x/colportores/${COLPORTOR_ID}/zona`,
      ],
      [
        "usuarioId no es UUID",
        { zonaId: ZONA_ID },
        `/v1/campanias/${CAMPANIA_ID}/colportores/x/zona`,
      ],
      ["zonaId no es UUID", { zonaId: "centro" }, RUTA],
      ["falta zonaId", {}, RUTA],
      ["zonaId es null", { zonaId: null }, RUTA],
      ["el cuerpo no es JSON", "zonaId=centro", RUTA],
    ])("responde 400 si %s, sin llamar al RPC", async (_caso, cuerpo, ruta) => {
      const llamadas = supabaseAsigna(() => Response.json(FILA));
      const res = await asignar(cuerpo, ruta);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "entrada_invalida" });
      expect(llamadasAlRpc(llamadas)).toHaveLength(0);
    });
  });

  describe("cuando la base rechaza la asignación por una regla de la HU", () => {
    it.each([
      ["CZ001", 404, "campania_no_encontrada", "La campaña no existe."],
      [
        "CZ002",
        409,
        "campania_no_vigente",
        "La campaña no está activa: solo se asignan zonas en una campaña vigente.",
      ],
      ["CZ003", 404, "colportor_no_inscripto", "El colportor no está en esta campaña."],
      ["CZ004", 422, "zona_no_encontrada", "La zona no existe."],
      ["CZ005", 422, "zona_de_otra_ciudad", "La zona no pertenece a la ciudad de la campaña."],
      ["CZ006", 422, "zona_de_otra_campania", "La zona pertenece a otra campaña."],
    ])("%s responde %i %s con el mensaje del backend", async (code, status, error, mensaje) => {
      supabaseAsigna(errorPostgrest(400, code, mensaje));
      const res = await asignar();

      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error, mensaje });
    });

    it("un código de inscripción (CI0xx) no se traduce acá: responde 502", async () => {
      supabaseAsigna(errorPostgrest(400, "CI006", "Ya está inscripto en esta campaña."));
      const res = await asignar();

      expect(res.status).toBe(502);
    });
  });

  describe("cuando no coordina esa campaña", () => {
    it("responde 403 sin_permiso_en_campania", async () => {
      supabaseAsigna(errorPostgrest(403, "42501", SIN_PERMISO));
      const res = await asignar();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "sin_permiso_en_campania", mensaje: SIN_PERMISO });
    });
  });

  describe("cuando el usuario no es coordinador", () => {
    it("responde 403 sin llamar al RPC", async () => {
      const llamadas = supabaseAsigna(() => Response.json(FILA), false);
      const res = await asignar();

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "forbidden" });
      expect(llamadasAlRpc(llamadas)).toHaveLength(0);
    });
  });

  describe("cuando el JWT no sirve", () => {
    it("responde 401 sin JWT", async () => {
      const res = await SELF.fetch(`https://bff.test${RUTA}`, {
        method: "PUT",
        body: JSON.stringify({ zonaId: ZONA_ID }),
      });

      expect(res.status).toBe(401);
    });

    it.each(["PGRST301", "42501"])("responde 401 si PostgREST da 401 con %s", async (code) => {
      supabaseAsigna(errorPostgrest(401, code, "rechazado"));
      const res = await asignar();

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });
  });

  describe("cuando Supabase falla de otra forma", () => {
    it("responde 502 con un code desconocido", async () => {
      supabaseAsigna(errorPostgrest(400, "CZ999", "regla nueva"));
      const res = await asignar();

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream_error" });
    });

    it("responde 502 si el UPDATE directo se colara y diera 23514", async () => {
      supabaseAsigna(errorPostgrest(400, "23514", "check_violation"));
      const res = await asignar();

      expect(res.status).toBe(502);
    });

    it("responde 502 si el RPC devuelve una fila con otra forma", async () => {
      supabaseAsigna(() => Response.json([FILA]));
      const res = await asignar();

      expect(res.status).toBe(502);
    });

    it("responde 504 si Supabase no responde a tiempo", async () => {
      supabaseAsigna(() => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      });
      const res = await asignar();

      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({ error: "upstream_timeout" });
    });
  });
});
