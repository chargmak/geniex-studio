import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ApprovalDecision, ApprovalRequest, ToolRisk } from '@shared/agent'
import type { Database } from '../db'
import type { SettingsStore } from '../settings'

interface Pending {
  request: ApprovalRequest
  resolve: (d: ApprovalDecision) => void
}

/**
 * Human-in-the-loop gate. Order of evaluation: explicit deny rule → explicit allow rule → risk auto-approve
 * setting → tool.needsApproval → ask. "Allow always" persists a per-tool allow rule.
 */
export class ApprovalCenter extends EventEmitter {
  private pending = new Map<string, Pending>()

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsStore,
  ) {
    super()
  }

  rules(): { id: string; tool: string; pattern: string | null; decision: 'allow' | 'deny'; createdAt: number }[] {
    return (this.db.prepare('SELECT * FROM approvals_rules ORDER BY created_at').all() as { id: string; tool: string; pattern: string | null; decision: 'allow' | 'deny'; created_at: number }[]).map((r) => ({
      id: r.id,
      tool: r.tool,
      pattern: r.pattern,
      decision: r.decision,
      createdAt: r.created_at,
    }))
  }

  addRule(tool: string, decision: 'allow' | 'deny', pattern: string | null = null): void {
    this.db.prepare('INSERT INTO approvals_rules (id, tool, pattern, decision, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), tool, pattern, decision, Date.now())
    this.emit('rules')
  }

  removeRule(id: string): void {
    this.db.prepare('DELETE FROM approvals_rules WHERE id = ?').run(id)
    this.emit('rules')
  }

  decide(tool: string, risk: ToolRisk, needsApproval: boolean, summary: string): 'allow' | 'deny' | 'ask' {
    const rules = this.rules().filter((r) => r.tool === tool || r.tool === '*')
    const matches = (r: { pattern: string | null }): boolean => {
      if (!r.pattern) return true
      try {
        return new RegExp(r.pattern, 'i').test(summary)
      } catch {
        return summary.includes(r.pattern)
      }
    }
    if (rules.some((r) => r.decision === 'deny' && matches(r))) return 'deny'
    if (rules.some((r) => r.decision === 'allow' && matches(r))) return 'allow'
    if (this.settings.get().agent.autoApproveRisks.includes(risk)) return 'allow'
    return needsApproval ? 'ask' : 'allow'
  }

  /** Blocks until the user answers (or the run is cancelled). */
  request(input: Omit<ApprovalRequest, 'id' | 'createdAt'>, signal: AbortSignal): Promise<ApprovalDecision> {
    const request: ApprovalRequest = { ...input, id: randomUUID(), createdAt: Date.now() }
    return new Promise<ApprovalDecision>((resolve) => {
      const done = (d: ApprovalDecision): void => {
        this.pending.delete(request.id)
        signal.removeEventListener('abort', onAbort)
        resolve(d)
      }
      const onAbort = (): void => done('deny')
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(request.id, { request, resolve: done })
      this.emit('request', request)
    })
  }

  respond(id: string, decision: ApprovalDecision): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    if (decision === 'allow-always') this.addRule(p.request.tool, 'allow')
    p.resolve(decision)
    this.emit('decision', { requestId: id, decision })
    return true
  }

  listPending(runId?: string): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request).filter((r) => !runId || r.runId === runId)
  }
}
