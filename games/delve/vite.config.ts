import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// DELVE is a multi-page client: the game plus the developer sandboxes. Each HTML file is a
// Vite entry, so `vite build` emits them all and `vite dev` serves them with HMR. The Node
// tools (verify / sim) and the future server import the same TypeScript modules directly.
export default defineConfig({
  root: __dirname,
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        styleLab: resolve(__dirname, 'style-lab.html'),
        renderTool: resolve(__dirname, 'tools/render.html'),
        lightLab: resolve(__dirname, 'tools/light-lab.html'),
      },
    },
  },
});
