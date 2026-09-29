import { Hono } from "hono";
import type { AppEnv } from "../types";

/** `GET /health` — liveness. Público, sin JWT. Lo usa el monitoreo y el smoke test post-deploy. */
export const health = new Hono<AppEnv>().get("/", (c) =>
  c.json({ status: "ok", servicio: "bff-coordinadores", entorno: c.env.ENVIRONMENT }),
);
