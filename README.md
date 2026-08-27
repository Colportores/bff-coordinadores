# bff-coordinadores

BFF de el panel de coordinadores ([front-coordinadores-web](https://github.com/Colportores/front-coordinadores-web)), como Worker de Cloudflare.

**Estado: en construcción** — repo creado según la nomenclatura de [ADR-015](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-015-nomenclatura-repositorios.md); todavía sin código.

## Contexto

Parte del sistema [Colportaje App](https://github.com/Colportores). La arquitectura, los flujos y las decisiones viven en la [documentación de la organización](https://github.com/Colportores/docs-organizacion).

- Es un **adaptador sin estado** ([ADR-016](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-016-bff-por-aplicacion.md)): valida el JWT de Supabase Auth, lo reenvía a RPCs o vistas de Postgres y da forma a la respuesta. No tiene base propia y no contiene lógica de dominio.
- **La autoridad de permisos es la RLS**, no este Worker.
- Stack previsto: Cloudflare Workers + TypeScript.
- Backend: [backend-supabase](https://github.com/Colportores/backend-supabase) ([ADR-002](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-002-proveedor-cloud.md)).

### Alcance

Agregados por equipo y por zona, asignación de territorios, seguimiento de jornadas y reportes de la asociación a cargo del coordinador.

## Privacidad

Los datos personales de clientes (`persona.nombre`, `persona.apellido`, `persona.telefono`, `nota.texto`) son **local-only**: viven solo en el dispositivo del colportor y nunca llegan al cloud, por la Ley 18.331 de Uruguay. Ver [`02-restricciones.md`](https://github.com/Colportores/docs-organizacion/blob/main/docs/02-restricciones.md). Este repositorio no puede almacenarlos, transportarlos ni loguearlos.

## Licencia

Uso propio — todos los derechos reservados. Ver [LICENSE](./LICENSE).
