import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    vinext(),
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
      ...(process.env.CARELINK_LOCAL_NO_NOTIFICATIONS === "1" ? { "@/lib/booking-create-dispatch": path.resolve(root, "tools/cloudflare/fixtures/booking-dispatch-stub.ts") } : {}),
      "./og-image-assets": path.resolve(root, "tools/cloudflare/og-image-assets.ts"),
      "@vercel/speed-insights/next": path.resolve(root, "tools/cloudflare/speed-insights-stub.tsx"),
      "sharp": path.resolve(root, "tools/cloudflare/sharp-stub.ts"),
    },
  },
});
