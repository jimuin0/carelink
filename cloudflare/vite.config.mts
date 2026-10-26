import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import nextConfig from "./next.config.mjs";
import { stagingEnv } from './cloudflare/staging-env.mjs';

export default defineConfig({
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
    vinext({ nextConfig: { ...nextConfig, output: undefined } }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
