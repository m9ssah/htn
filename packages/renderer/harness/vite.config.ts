import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    // Exact matches only, so subpath imports like `@jit/tokens/fonts.css` still
    // resolve through the package exports map.
    alias: [
      { find: /^@jit\/schema$/, replacement: pkg('schema') },
      { find: /^@jit\/tokens$/, replacement: pkg('tokens') },
      { find: /^@jit\/renderer$/, replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
    ],
  },
  server: { port: 5174 },
});
