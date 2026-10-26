import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import nextConfig from "./next.config.mjs";
import { stagingEnv } from './cloudflare/staging-env.mjs';
import { kvDataAdapter } from '@vinext/cloudflare/cache/kv-data-adapter';
import { imagesOptimizer } from '@vinext/cloudflare/images/images-optimizer';

export default defineConfig({
  // Workerd's RSC loader imports this exact SSR module name. Vite otherwise
  // chooses index.mjs for the application's CommonJS package scope.
  environments: {
    ssr: { build: { rolldownOptions: { output: { entryFileNames: 'index.js' } } } },
  },
  define: Object.fromEntries(Object.entries(stagingEnv(process.env))
    .filter(([key]) => key.startsWith('NEXT_PUBLIC_'))
    .map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])),
  plugins: [
    {
      name: "carelink-cloudflare-og-assets",
      enforce: "pre",
      transform(code, id) {
        if (id.split("?")[0] !== path.resolve("src/lib/og-image.ts")) return;
        return { code: code.replace("from 'node:fs/promises'", `from ${JSON.stringify(path.resolve("cloudflare/og-assets.mjs"))}`), map: null };
      },
    },
    vinext({
      nextConfig: { ...nextConfig, output: undefined },
      cache: { data: kvDataAdapter({ appPrefix: 'carelink-staging' }) },
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
