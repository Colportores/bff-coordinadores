import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/lib/log";

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("cuando se emite un INFO con contexto", () => {
    it("escribe una línea JSON con nivel, módulo, operación, mensaje y contexto", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      log.info("AUTH", "JWT_OK", "token válido", { userId: "uuid", intentos: 1 });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toEqual({
        nivel: "INFO",
        modulo: "AUTH",
        op: "JWT_OK",
        msg: "token válido",
        userId: "uuid",
        intentos: 1,
      });
    });
  });

  describe("cuando se emite sin contexto", () => {
    it("DEBUG sale por console.log solo con los campos base", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      log.debug("NET", "REQ", "entrada");

      expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toEqual({
        nivel: "DEBUG",
        modulo: "NET",
        op: "REQ",
        msg: "entrada",
      });
    });
  });

  describe("cuando el nivel es WARN o ERROR", () => {
    it("WARN usa console.warn", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      log.warn("SYNC", "RETRY", "reintentando", { attempt: 2 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({ nivel: "WARN" });
    });

    it("ERROR usa console.error", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      log.error("CATALOGO", "PULL_FAIL", "falló", { status: 503 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({ nivel: "ERROR" });
    });
  });
});
