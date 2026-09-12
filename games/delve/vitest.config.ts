// vitest.config.ts — the DELVE test runner. Two projects by environment:
//   • node — the pure sim + world-gen (@delve/shared), and the real client↔server protocol
//     roundtrip (@delve/server spawns the actual server).
//   • dom  — the client's DOM chrome (save migration, the inventory panel) under happy-dom.
// Tests are co-located as `*.test.ts` next to the code they cover. Both projects resolve
// `@delve/shared` straight from source (mirrors client/vite.config.ts + the tsconfig paths),
// so there's no prebuild step. Property/fuzz tests use fast-check.
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// @delve/shared → source (no dist prebuild needed for tests)
const alias = { '@delve/shared': resolve(__dirname, 'shared/src/index.ts') };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'tools/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['client/**/*.test.ts'],
        },
      },
    ],
  },
});
