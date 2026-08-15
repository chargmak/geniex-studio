import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { MIGRATIONS } from './schema'

export type Database = BetterSqlite3.Database

const require = createRequire(import.meta.url)

/** Open (and migrate) the Studio database at dataDir/studio.db. Uses better-sqlite3's win32-arm64 prebuild. */
export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true })
  const Sqlite = require('better-sqlite3') as typeof BetterSqlite3
  const db = new Sqlite(join(dataDir, 'studio.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  let current = row?.v ?? 0
  const apply = db.transaction((version: number, sql: string) => {
    db.exec(sql)
    db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(version)
  })
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      apply(m.version, m.sql)
      current = m.version
    }
  }
}
