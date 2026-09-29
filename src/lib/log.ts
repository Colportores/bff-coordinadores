/**
 * Logger estructurado del BFF.
 *
 * Sigue el formato `[NIVEL][MÓDULO][OPERACIÓN] mensaje — {contexto}` de
 * docs-organizacion/docs/convenciones-desarrollo.md §7, serializado como JSON para que
 * Workers Logs lo indexe por campo.
 *
 * Regla no negociable (Ley 18.331): acá nunca entra PII. Solo UUIDs y metadatos.
 */

export type Nivel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type Modulo = "AUTH" | "NET" | "SYNC" | "CATALOGO";
export type Contexto = Record<string, string | number | boolean | null | undefined>;

function emitir(nivel: Nivel, modulo: Modulo, op: string, msg: string, ctx: Contexto = {}): void {
  const linea = JSON.stringify({ nivel, modulo, op, msg, ...ctx });
  switch (nivel) {
    case "ERROR":
      console.error(linea);
      break;
    case "WARN":
      console.warn(linea);
      break;
    default:
      console.log(linea);
  }
}

export const log = {
  debug: (modulo: Modulo, op: string, msg: string, ctx?: Contexto): void =>
    emitir("DEBUG", modulo, op, msg, ctx),
  info: (modulo: Modulo, op: string, msg: string, ctx?: Contexto): void =>
    emitir("INFO", modulo, op, msg, ctx),
  warn: (modulo: Modulo, op: string, msg: string, ctx?: Contexto): void =>
    emitir("WARN", modulo, op, msg, ctx),
  error: (modulo: Modulo, op: string, msg: string, ctx?: Contexto): void =>
    emitir("ERROR", modulo, op, msg, ctx),
};
