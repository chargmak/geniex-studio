#!/usr/bin/env node
/**
 * Flips the draft GitHub release created by `npm run release` to published.
 *
 * Installed copies of Studio only see published releases, so this is the switch that actually ships an update.
 * It refuses to publish unless the three assets electron-updater needs are attached.
 *
 * Usage: npm run release:publish            (publishes v<version from package.json>)
 *        npm run release:publish -- v0.2.0  (explicit tag)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = process.argv[2] ?? `v${pkg.version}`

function gh(args) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

let release
try {
  release = JSON.parse(gh(['release', 'view', tag, '--json', 'isDraft,assets,url']))
} catch {
  console.error(`No GitHub release found for ${tag}. Run "npm run release" first.`)
  process.exit(1)
}

const names = release.assets.map((a) => a.name)
const required = [
  { label: 'installer', test: (n) => n.endsWith('.exe') },
  { label: 'blockmap (differential updates)', test: (n) => n.endsWith('.exe.blockmap') },
  { label: 'latest.yml (update feed)', test: (n) => n === 'latest.yml' },
]
const missing = required.filter((r) => !names.some(r.test))
if (missing.length) {
  console.error(`${tag} is missing: ${missing.map((m) => m.label).join(', ')}`)
  console.error(`Attached assets: ${names.join(', ') || '(none)'}`)
  process.exit(1)
}

if (!release.isDraft) {
  console.log(`${tag} is already published: ${release.url}`)
  process.exit(0)
}

gh(['release', 'edit', tag, '--draft=false', '--latest'])
console.log(`Published ${tag} — installed copies will pick it up on their next check.`)
console.log(release.url)
