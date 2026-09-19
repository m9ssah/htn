import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Exact matches only, so `@jit/tokens/fonts.css` still resolves through the
  // package exports map.
  resolve: {
    alias: [
      { find: /^@jit\/schema$/, replacement: pkg('schema') },
      { find: /^@jit\/tokens$/, replacement: pkg('tokens') },
      { find: /^@jit\/renderer$/, replacement: pkg('renderer') },
    ],
  },
  server: { port: 3000, host: true, strictPort: true },
});
