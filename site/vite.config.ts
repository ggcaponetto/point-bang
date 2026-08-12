import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by GitHub Pages under the repo's docs site, beside /phone/.
export default defineConfig({
  base: "/point-bang/start/",
  plugins: [react()],
  build: { outDir: "../docs/public/start", emptyOutDir: true },
});
