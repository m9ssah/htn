import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    /**
     * Resolve the workspace packages to their SOURCE, not their build output.
     *
     * The package `exports` point at `dist/`, so without this a test run races
     * any concurrent `tsc -b` and can import a half-written build — and `npm
     * test` would silently require `npm run build` first. Exact matches only, so
     * subpath imports like `@jit/tokens/fonts.css` still go through the exports
     * map.
     */
    alias: [
      { find: /^@jit\/schema$/, replacement: pkg('schema') },
      { find: /^@jit\/tokens$/, replacement: pkg('tokens') },
      { find: /^@jit\/renderer$/, replacement: pkg('renderer') },
    ],
  },
  test: {
    environment: 'happy-dom',
    include: ['packages/*/test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['packages/*/test/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
});
