const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID en forma canónica (8-4-4-4-12 hex, cualquier versión). Lo demás no se manda a Supabase. */
export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}
