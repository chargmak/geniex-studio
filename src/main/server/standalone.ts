/**
 * Headless runner for `npm run serve` (dev, via tsx) — starts the Studio API server without Electron.
 * Serves the built renderer from out/renderer when present (run `npm run build` first), otherwise API only
 * (pair it with `electron-vite dev`'s renderer or the Vite dev server for UI work).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { boot } from '../bootstrap'

const root = resolve(process.cwd())
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
const rendererDir = join(root, 'out', 'renderer')

boot({
  mode: 'headless',
  version: pkg.version,
  rendererDir: existsSync(rendererDir) ? rendererDir : undefined,
  host: process.env.GENIEX_STUDIO_HOST,
})
  .then(({ server, ctx }) => {
    if (!ctx.rendererDir) console.log('[studio] renderer not built — API only (run `npm run build` to serve the UI too)')
    console.log(`[studio] open ${server.url}`)
  })
  .catch((err) => {
    console.error('[studio] failed to start', err)
    process.exit(1)
  })
