# bff-coordinadores

BFF del panel de coordinadores ([front-coordinadores-web](https://github.com/Colportores/front-coordinadores-web)), como Worker de Cloudflare.

**Estado: en construcción** — `GET /health`, verificación del JWT, rol `COORDINADOR` y `GET /v1/me` (front-coordinadores-web#18). Los endpoints de datos llegan con las HU del coordinador.

## Contexto

Parte del sistema [Colportaje App](https://github.com/Colportores). La arquitectura, los flujos y las decisiones viven en la [documentación de la organización](https://github.com/Colportores/docs-organizacion).

- Es un **adaptador sin estado** ([ADR-013](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-013-un-bff-por-aplicacion-en-workers.md)): valida el JWT de Supabase Auth, lo reenvía a RPCs o vistas de Postgres y da forma a la respuesta. No tiene base propia y no contiene lógica de dominio.
- **La autoridad de permisos es la RLS**, no este Worker.
- Stack: Cloudflare Workers + TypeScript + Hono.
- Backend: [backend-supabase](https://github.com/Colportores/backend-supabase) ([ADR-012](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-012-backend-supabase-sa-east-1.md)).

### Alcance

Agregados por equipo y por zona, asignación de territorios, seguimiento de jornadas y reportes de la asociación a cargo del coordinador.

## Rutas

| Ruta | Acceso | Qué hace |
|---|---|---|
| `GET /health` | público | Liveness. |
| `GET /v1/*` | JWT de Supabase Auth + rol `COORDINADOR` vigente | Todo lo del panel. |
| `GET /v1/me` | ídem | Perfil del coordinador para el topbar: `{ userId, nombre, iniciales }`. |

### Auth

El panel hace el login directo contra Supabase Auth con `supabase-js` (ADR-013) y manda el JWT en `Authorization: Bearer <jwt>`. En cada request a `/v1/*`:

0. `requireConfig` corta con **503** `config_error` si `SUPABASE_URL` o `SUPABASE_ANON_KEY` faltan o son un placeholder `REEMPLAZAR`.
1. `requireAuth` verifica firma, emisor (`${SUPABASE_URL}/auth/v1`), audiencia (`authenticated`), `exp` y `sub`. Sin token o con token inválido: **401**. Si el JWKS de Supabase Auth no responde o es inválido: **502**.
2. `requireCoordinador` llama a `public.tiene_rol('COORDINADOR')` por PostgREST **con el JWT del propio usuario**. La función respeta la vigencia (`valido_desde`/`valido_hasta`) y las bajas. Si no es coordinador: **403**. El rol nunca se lee de un claim del token ni de un header.
3. Las rutas leen de PostgREST con el mismo JWT: la RLS decide qué ve cada coordinador.

Si PostgREST rechaza el JWT (401 con `code` `PGRST3xx` o `42501`): **401**. Cualquier otra falla de Supabase, incluido un 401 sin ese `code` (API key inválida): **502** `upstream_error`. Config faltante o Supabase caído nunca son 401: el panel lo tomaría como sesión vencida y mandaría a todos a loguearse en loop.

### Configuración

| Variable | Dónde | Qué es |
|---|---|---|
| `SUPABASE_URL` | `wrangler.jsonc` → `vars` | Proyecto Supabase por entorno. |
| `SUPABASE_ANON_KEY` | `wrangler.jsonc` → `vars` | Clave anon/publishable para el header `apikey` de PostgREST. Es pública por diseño; los permisos los da el JWT. |
| `CORS_ORIGINS` | `wrangler.jsonc` → `vars` | Orígenes del panel que pueden llamar desde el navegador, separados por comas. **Staging y producción tienen un valor `REEMPLAZAR`: el dominio del panel todavía no está definido.** |
| `SUPABASE_JWT_SECRET` | `.dev.vars` / `wrangler secret put` | Solo para proyectos con firma HS256 legacy. Vacío: se valida contra el JWKS del proyecto. |

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
