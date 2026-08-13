import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The editor ships as ONE self-contained file: public/editor.html. That is
// what keeps the rest of the project ignorant of the bundler — the SEA asset
// list only supports flat names, the server serves it like any other static
// asset, and the /editor.html URL in the banner never changed.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../public",
    // NEVER wipe public/ — the buildless phone page lives there.
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: { input: path.resolve(HERE, "editor.html") },
  },
  server: {
    // `npm run -w editor dev` against a running `npm start`: the PC server's
    // CORS allowlist rejects the vite origin, so proxy instead.
    proxy: {
      "/buttons.json": "http://localhost:8443",
      "/buttons": "http://localhost:8443",
      "/monitors": "http://localhost:8443",
    },
    fs: {
      // the shared vocabulary (public/math.js, public/transport.js) lives
      // outside the package root
      allow: [HERE, path.resolve(HERE, "../public")],
    },
  },
});
