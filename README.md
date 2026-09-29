# bff-coordinadores

BFF de el panel de coordinadores ([front-coordinadores-web](https://github.com/Colportores/front-coordinadores-web)), como Worker de Cloudflare.

**Estado: en construcción** — esqueleto con `GET /health`; el login y los endpoints llegan con front-coordinadores-web#18.

## Contexto

Parte del sistema [Colportaje App](https://github.com/Colportores). La arquitectura, los flujos y las decisiones viven en la [documentación de la organización](https://github.com/Colportores/docs-organizacion).

- Es un **adaptador sin estado** ([ADR-016](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-016-bff-por-aplicacion.md)): valida el JWT de Supabase Auth, lo reenvía a RPCs o vistas de Postgres y da forma a la respuesta. No tiene base propia y no contiene lógica de dominio.
- **La autoridad de permisos es la RLS**, no este Worker.
- Stack previsto: Cloudflare Workers + TypeScript.
- Backend: [backend-supabase](https://github.com/Colportores/backend-supabase) ([ADR-002](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-002-proveedor-cloud.md)).

### Alcance

Agregados por equipo y por zona, asignación de territorios, seguimiento de jornadas y reportes de la asociación a cargo del coordinador.

## Desarrollo

Todo corre en Docker; no hace falta Node en el host.

```sh
docker compose -f compose.dev.yml build
docker compose -f compose.dev.yml run --rm bff npm run check   # lint + typecheck + tests con cobertura
docker compose -f compose.dev.yml up                            # wrangler dev en http://localhost:8788
```

El puerto del host es 8788 para poder correr a la vez que `bff-colportores` (8787).

## Privacidad

Los datos personales de clientes (`persona.nombre`, `persona.apellido`, `persona.telefono`, `nota.texto`) son **local-only**: viven solo en el dispositivo del colportor y nunca llegan al cloud, por la Ley 18.331 de Uruguay. Ver [`02-restricciones.md`](https://github.com/Colportores/docs-organizacion/blob/main/docs/02-restricciones.md). Este repositorio no puede almacenarlos, transportarlos ni loguearlos.

## Licencia

Uso propio — todos los derechos reservados. Ver [LICENSE](./LICENSE).
