# Procedencia de las skills de este repo

| Skill | Fuente oficial | Commit verificado | Licencia |
|---|---|---|---|
| `cloudflare`, `wrangler`, `workers-best-practices` | [cloudflare/skills](https://github.com/cloudflare/skills) → `skills/*` | `f96bff7` (2026-08-07) | Apache-2.0 |

Verificado el 2026-09-01: es el **mismo commit** al que apunta el marketplace oficial de plugins de Anthropic (`anthropics/claude-plugins-official`) para el plugin `cloudflare`, y el contenido (`SKILL.md` + `references/`) está **al día, sin diffs** contra ese commit. No hizo falta actualizar nada.

## Por qué solo estas tres

El repo del catálogo oficial también trae `agents-sdk`, `durable-objects`, `cloudflare-email-service`, `cloudflare-one(-migrations)`, `sandbox-*`, `turnstile-spin` y `web-perf`. Ninguna aplica: `bff-coordinadores` es un Worker HTTP simple (Hono, sin Durable Objects, sin Agents SDK, sin sandboxes). Agregarlas solo llenaría el contexto con documentación irrelevante (ver `organizacion` skill, "Errores a no repetir").

## Cómo verificar que sigue al día

```sh
git clone --depth 1 https://github.com/cloudflare/skills /tmp/cloudflare-skills
for s in cloudflare wrangler workers-best-practices; do
  diff -rq /tmp/cloudflare-skills/skills/$s .claude/skills/$s --exclude=LICENSE
done
```

Sin salida = sin cambios. Si hay diffs, copiar el skill actualizado y volver a copiar `LICENSE` (Apache-2.0, en la raíz del repo fuente) dentro de cada carpeta.
