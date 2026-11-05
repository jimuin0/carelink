import { defineConfig } from "vite";
import vinext from "vinext";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    vinext({ images: { optimizer: { ...imagesOptimizer(), adapter: path.resolve(root, "tools/cloudflare/safe-image-optimizer.ts") } } }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  environments: { ssr: { build: { rollupOptions: { output: { entryFileNames: "[name].js" } } } } },
  resolve: {
    alias: {
      "./after-response": path.resolve(root, "tools/cloudflare/after-response.ts"),
      "@/lib/after-response": path.resolve(root, "tools/cloudflare/after-response.ts"),
      "./og-image-assets": path.resolve(root, "tools/cloudflare/og-image-assets.ts"),
      "./public-read-transport": path.resolve(root, "tools/cloudflare/public-read-transport.ts"),
      "@/lib/public-read-transport": path.resolve(root, "tools/cloudflare/public-read-transport.ts"),
      "@vercel/speed-insights/next": path.resolve(root, "tools/cloudflare/speed-insights-stub.tsx"),
      "sharp": path.resolve(root, "tools/cloudflare/sharp-stub.ts"),
    },
  },
});
