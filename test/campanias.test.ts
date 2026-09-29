import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LlamadaSupabase, simularSupabase, tokenDePrueba, USER_ID } from "./helpers";

const CAMPANIA_ID = "01920000-0000-7000-8000-0000000000c1";
const COLPORTOR_ID = "01920000-0000-7000-8000-0000000000a1";
const RUTA = `/v1/campanias/${CAMPANIA_ID}/colportores`;
const RPC = "/rest/v1/rpc/inscribir_colportor";

const FILA_CREADA = {
  id: "01920000-0000-7000-8000-0000000000f1",
  campania_id: CAMPANIA_ID,
  usuario_id: COLPORTOR_ID,
  zona_id: null,
  meta_libros: null,
  created_at: "2026-09-29T12:00:00+00:00",
  updated_at: "2026-09-29T12:00:00+00:00",
  created_by: USER_ID,
  deleted_at: null,
  sync_version: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Supabase con el coordinador habilitado; `inscribir` responde lo que diga el test. */
function supabaseInscribe(inscribir: () => Response, esCoordinador = true): LlamadaSupabase[] {
  return simularSupabase((req) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/rest/v1/rpc/tiene_rol") return Response.json(esCoordinador);
    if (pathname === RPC) return inscribir();
    return new Response("ruta no simulada", { status: 500 });
  });
}

function errorPostgrest(status: number, code: string, message: string, details?: string) {
  return () => Response.json({ code, message, details: details ?? null, hint: null }, { status });
}

async function inscribir(
  cuerpo: unknown = { usuarioId: COLPORTOR_ID },
  ruta = RUTA,
  token?: string,
): Promise<Response> {
  return SELF.fetch(`https://bff.test${ruta}`, {
    method: "POST",
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

describe("POST /v1/campanias/:campaniaId/colportores", () => {
  describe("cuando la inscripción entra", () => {
    it("responde 201 con la inscripción creada", async () => {
      supabaseInscribe(() => Response.json(FILA_CREADA));
      const res = await inscribir();

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        id: FILA_CREADA.id,
        campaniaId: CAMPANIA_ID,
        usuarioId: COLPORTOR_ID,
        zonaId: null,
        metaLibros: null,
        creadaEn: FILA_CREADA.created_at,
      });
    });

    it("llama a inscribir_colportor con el JWT del coordinador y los ids", async () => {
      const llamadas = supabaseInscribe(() => Response.json(FILA_CREADA));
      const token = await tokenDePrueba();
      await inscribir(undefined, RUTA, token);

      const [llamada] = llamadasAlRpc(llamadas);
      expect(llamada?.method).toBe("POST");
      expect(llamada?.headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(llamada?.headers.get("apikey")).toBe(env.SUPABASE_ANON_KEY);
      expect(JSON.parse(llamada?.cuerpo ?? "null")).toEqual({
        p_campania_id: CAMPANIA_ID,
        p_usuario_id: COLPORTOR_ID,
      });
    });
  });

  describe("cuando la entrada no es válida", () => {
    it.each([
      [
        "campaniaId no es UUID",
        { usuarioId: COLPORTOR_ID },
        "/v1/campanias/no-es-uuid/colportores",
      ],
      ["usuarioId no es UUID", { usuarioId: "123" }, RUTA],
      ["falta usuarioId", {}, RUTA],
      ["usuarioId no es string", { usuarioId: 42 }, RUTA],
      ["el cuerpo no es JSON", "usuarioId=abc", RUTA],
      ["el cuerpo es null", "null", RUTA],
    ])("responde 400 si %s, sin llamar al RPC", async (_caso, cuerpo, ruta) => {
      const llamadas = supabaseInscribe(() => Response.json(FILA_CREADA));
      const res = await inscribir(cuerpo, ruta);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "entrada_invalida" });
      expect(llamadasAlRpc(llamadas)).toHaveLength(0);
    });
  });

  describe("cuando la base rechaza la inscripción por una regla de la HU", () => {
    it.each([
      ["CI001", 404, "campania_no_encontrada", "La campaña no existe."],
      [
        "CI002",
        409,
        "campania_no_vigente",
        "La campaña no está activa: solo se inscribe en una campaña vigente.",
      ],
      ["CI003", 422, "usuario_no_encontrado", "El usuario no existe o fue dado de baja."],
      ["CI004", 409, "email_sin_verificar", "El usuario todavía no verificó su email."],
      ["CI005", 409, "cuenta_suspendida", "La cuenta está suspendida. Contactá al administrador."],
      ["CI006", 409, "ya_inscripto", "Ya está inscripto en esta campaña."],
      [
        "CI008",
        409,
        "inscripcion_dada_de_baja",
        "Tiene una inscripción dada de baja en esta campaña.",
      ],
    ])("%s responde %i %s con el mensaje del backend", async (code, status, error, mensaje) => {
      supabaseInscribe(errorPostgrest(400, code, mensaje));
      const res = await inscribir();

      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error, mensaje });
    });

    it("CI007 responde 409 con el literal de la HU y la campaña en conflicto", async () => {
      const otra = {
        campania_id: "01920000-0000-7000-8000-0000000000c2",
        campania_nombre: "Verano 2026",
      };
      supabaseInscribe(
        errorPostgrest(
          400,
          "CI007",
          "Está en campaña Verano 2026. Reasignar primero.",
          JSON.stringify(otra),
        ),
      );
      const res = await inscribir();

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "en_otra_campania",
        mensaje: "Está en campaña Verano 2026. Reasignar primero.",
        campania: { id: otra.campania_id, nombre: "Verano 2026" },
      });
    });

    it("CI007 sin details legibles responde igual 409, con campania null", async () => {
      supabaseInscribe(
        errorPostgrest(400, "CI007", "Está en campaña X. Reasignar primero.", "no es json"),
      );
      const res = await inscribir();

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "en_otra_campania", campania: null });
    });
  });

  describe("cuando no coordina esa campaña", () => {
    it("responde 403 sin_permiso_en_campania", async () => {
      supabaseInscribe(
        errorPostgrest(
          403,
          "42501",
          "Solo el coordinador de la campaña puede inscribir colportores en ella.",
        ),
      );
      const res = await inscribir();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "sin_permiso_en_campania",
        mensaje: "Solo el coordinador de la campaña puede inscribir colportores en ella.",
      });
    });
  });

  describe("cuando el usuario no es coordinador", () => {
    it("responde 403 sin llamar al RPC", async () => {
      const llamadas = supabaseInscribe(() => Response.json(FILA_CREADA), false);
      const res = await inscribir();

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "forbidden" });
      expect(llamadasAlRpc(llamadas)).toHaveLength(0);
    });
  });

  describe("cuando no hay JWT", () => {
    it("responde 401", async () => {
      const res = await SELF.fetch(`https://bff.test${RUTA}`, {
        method: "POST",
        body: JSON.stringify({ usuarioId: COLPORTOR_ID }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("cuando PostgREST rechaza el JWT", () => {
    it("responde 401", async () => {
      supabaseInscribe(errorPostgrest(401, "PGRST301", "JWT expired"));
      const res = await inscribir();

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("responde 401 con 42501 y status 401 (PostgREST lo trató como anon)", async () => {
      supabaseInscribe(
        errorPostgrest(401, "42501", "inscribir_colportor requiere un usuario autenticado"),
      );
      const res = await inscribir();

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });
  });

  describe("cuando Supabase falla de otra forma", () => {
    it("responde 502 con un code desconocido", async () => {
      supabaseInscribe(errorPostgrest(400, "CI999", "regla nueva"));
      const res = await inscribir();

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream_error" });
    });

    it("un código de asignar zona (CZ0xx) no se traduce acá: responde 502", async () => {
      supabaseInscribe(errorPostgrest(400, "CZ003", "El colportor no está en esta campaña."));
      const res = await inscribir();

      expect(res.status).toBe(502);
    });

    it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
      "responde 502 con un code que es una propiedad del prototipo (%s)",
      async (code) => {
        supabaseInscribe(errorPostgrest(400, code, "no es un rechazo"));
        const res = await inscribir();

        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "upstream_error" });
      },
    );

    it("responde 502 con un CI0xx sin mensaje", async () => {
      supabaseInscribe(() => Response.json({ code: "CI006" }, { status: 400 }));
      const res = await inscribir();

      expect(res.status).toBe(502);
    });

    it("responde 502 con un CI0xx que no llega como 400", async () => {
      supabaseInscribe(errorPostgrest(500, "CI006", "Ya está inscripto en esta campaña."));
      const res = await inscribir();

      expect(res.status).toBe(502);
    });

    it("responde 502 si el RPC devuelve una fila con otra forma", async () => {
      supabaseInscribe(() => Response.json({ id: FILA_CREADA.id }));
      const res = await inscribir();

      expect(res.status).toBe(502);
    });

    it("responde 502 si Supabase no responde", async () => {
      supabaseInscribe(() => {
        throw new TypeError("fetch failed");
      });
      const res = await inscribir();

      expect(res.status).toBe(502);
    });
  });
});
