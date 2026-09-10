import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// DELVE is a multi-page client whose source lives under src/ (the game plus the browser dev
// sandboxes in src/labs). Vite's root is src/, so `vite dev` serves the game at `/` and each
// HTML file is a build entry; `vite build` emits them to dist/ (a sibling of src/). The Node
// CLI tools (tools/verify.ts, tools/sim.ts) aren't built — they run under tsx and import the
// same src/scripts modules directly.
const src = resolve(__dirname, 'src');
export default defineConfig({
  root: src,
  build: {
    target: 'es2022',
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true, // dist/ is outside root, so Vite needs explicit permission to clear it
    rollupOptions: {
      input: {
        game: resolve(src, 'index.html'),
        styleLab: resolve(src, 'labs/style-lab.html'),
        renderTool: resolve(src, 'labs/render.html'),
        lightLab: resolve(src, 'labs/light-lab.html'),
      },
    },
  },
});
