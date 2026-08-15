import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Port the in-process Hono API server listens on during development (renderer dev server proxies /api to it). */
const API_PORT = Number(process.env.GENIEX_STUDIO_PORT ?? 18190)

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
    plugins: [react(), tailwindcss()],
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
