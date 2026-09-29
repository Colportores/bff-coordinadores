import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Los tests corren DENTRO de workerd (mismo runtime que producción), con los bindings de
// wrangler.jsonc. API de vitest 4: el pool se registra como plugin.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 70, functions: 70, branches: 60 },
    },
  },
});
