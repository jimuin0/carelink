import { bindings, defineConfig, defineWorker } from "cf/config";
import { stagingEnv } from './cloudflare/staging-env.mjs';

const values = stagingEnv(process.env);

export default defineConfig({
  worker: defineWorker({
    name: "carelink-staging",
    entrypoint: "./cloudflare/staging-worker.mjs",
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, bindings.text(value)])),
    },
  }),
});
