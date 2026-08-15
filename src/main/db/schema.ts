/** Versioned migrations. Append only — never edit a shipped migration. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New chat',
        model TEXT,
        system_prompt TEXT,
        mode TEXT NOT NULL DEFAULT 'chat',          -- chat | agent
        settings_json TEXT NOT NULL DEFAULT '{}',   -- sampler / options / think per conversation
        workspace_root TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,                          -- system | user | assistant | tool
        content_json TEXT NOT NULL,                  -- string | content parts
        reasoning TEXT,
        tool_calls_json TEXT,
        tool_call_id TEXT,
        name TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'complete',     -- streaming | complete | error | cancelled
        error TEXT,
        metrics_json TEXT,                           -- ttftMs, totalMs, tokensPerSecond, usage
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, seq);

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        kind TEXT NOT NULL,                          -- image | audio | file
        name TEXT NOT NULL,
        mime TEXT,
        size INTEGER,
        path TEXT NOT NULL,                          -- absolute path under dataDir/attachments
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_msg ON attachments(message_id);

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        title TEXT,
        model TEXT,
        status TEXT NOT NULL,                        -- running | waiting_approval | done | error | cancelled
        turns INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT,
        summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,                          -- turn | tool_call | tool_result | approval | message | error | done
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, id);

      CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        model TEXT,
        compute TEXT,
        ttft_ms REAL,
        total_ms REAL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        tokens_per_second REAL,
        load_ms REAL,
        finish_reason TEXT,
        conversation_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(ts DESC);

      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT,
        settings_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,                     -- stdio | http
        command TEXT,
        args_json TEXT,
        env_json TEXT,
        url TEXT,
        headers_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        allow_json TEXT,                             -- tool allow-list (null = all)
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals_rules (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        pattern TEXT,                                -- glob/regex on args (optional)
        decision TEXT NOT NULL,                      -- allow | deny
        created_at INTEGER NOT NULL
      );
    `,
  },
]
