import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The client is a multi-page Vite app rooted at this folder: the game at `/`, the browser dev
// sandboxes under `/labs`. It bundles @delve/shared straight from source (alias below), so dev
// needs no shared prebuild; production emits to client/dist. The WebSocket is proxied to the Node
// server (server/) so the browser talks to a single origin in dev.
const WS_PATH = '/ws'; // mirrors WS_PATH in @delve/shared's protocol
const SERVER_PORT = 8787;

export default defineConfig({
  resolve: {
    alias: {
      '@delve/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        styleLab: resolve(__dirname, 'labs/style-lab.html'),
        renderTool: resolve(__dirname, 'labs/render.html'),
        lightLab: resolve(__dirname, 'labs/light-lab.html'),
        materialLab: resolve(__dirname, 'labs/material-lab.html'),
        spriteLab: resolve(__dirname, 'labs/sprite-lab.html'),
        uiLab: resolve(__dirname, 'labs/ui-lab.html'),
        fontLab: resolve(__dirname, 'labs/font-lab.html'),
      },
    },
  },
  server: {
    proxy: {
      [WS_PATH]: { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
});
