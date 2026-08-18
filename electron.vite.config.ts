import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Port the in-process Hono API server listens on during development (renderer dev server proxies /api to it). */
const API_PORT = Number(process.env.GENIEX_STUDIO_PORT ?? 18190)

/**
 * The renderer is always loaded over HTTP (the in-process Hono server), never file://, so asset URLs must be
 * absolute: with electron-vite's relative production default, a deep link such as /settings/updates asks for
 * /settings/assets/index-*.js and 404s. electron-vite forces `base: './'` from an `enforce: 'pre'` plugin,
 * so this unenforced plugin's config() hook runs afterwards and wins.
 */
const absoluteBase = { name: 'geniex:absolute-base', config: (c: { base?: string }) => void (c.base = '/') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'node-pty', 'node:sqlite'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      // Sandboxed preloads must be CommonJS (ESM preload requires sandbox: false).
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [absoluteBase, react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    server: {
      // Same-origin /api in dev: the Vite dev server forwards to the Hono server started by the Electron main process.
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${API_PORT}`,
          changeOrigin: false,
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
        },
      },
    },
  },
})
