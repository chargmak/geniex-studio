import { Hono } from 'hono'
import { z } from 'zod'

export const settingsRoutes = new Hono()

const computeSchema = z.enum(['npu', 'gpu', 'cpu', 'hybrid'])

const patchSchema = z
  .object({
    genie: z
      .object({
        cliPath: z.string().nullable(),
        host: z.string().regex(/^[\w.-]+:\d{2,5}$/, 'host must be host:port'),
        keepaliveSeconds: z.number().int().min(0).max(86_400),
        nctx: z.number().int().min(256).max(262_144),
        ngl: z.number().int().min(-1).max(999),
        compute: computeSchema.nullable(),
        origins: z.string(),
        logLevel: z.enum(['none', 'error', 'warn', 'info', 'debug', 'trace']),
        autoStart: z.boolean(),
        attachExisting: z.boolean(),
      })
      .partial(),
    defaults: z
      .object({
        chatModel: z.string().nullable(),
        visionModel: z.string().nullable(),
        agentModel: z.string().nullable(),
        sampler: z
          .object({
            temperature: z.number().min(0).max(2),
            top_p: z.number().min(0).max(1),
            top_k: z.number().int().min(0).max(1000),
            min_p: z.number().min(0).max(1),
            repetition_penalty: z.number().min(0).max(3),
            presence_penalty: z.number().min(-2).max(2),
            frequency_penalty: z.number().min(-2).max(2),
            seed: z.number().int(),
            max_tokens: z.number().int().min(1).max(131_072),
          })
          .partial(),
        enableThink: z.boolean(),
        computeGguf: computeSchema,
        systemPrompt: z.string().max(20_000),
        keepCache: z.boolean(),
      })
      .partial(),
    workspace: z.object({ root: z.string().nullable() }).partial(),
    agent: z
      .object({
        maxTurns: z.number().int().min(1).max(100),
        autoApproveRisks: z.array(z.enum(['read', 'write', 'exec', 'network', 'mcp'])),
        enabledFamilies: z.array(z.enum(['fs', 'shell', 'web', 'mcp', 'vision'])),
        instructions: z.string().max(20_000),
      })
      .partial(),
    ui: z.object({ theme: z.enum(['dark', 'light']), closeToTray: z.boolean(), launchAtLogin: z.boolean(), startMinimized: z.boolean() }).partial(),
    updates: z.object({ autoCheck: z.boolean(), autoDownload: z.boolean(), channel: z.enum(['stable', 'beta']) }).partial(),
    onboarding: z.object({ completed: z.boolean() }).partial(),
  })
  .partial()

settingsRoutes.get('/', (c) => c.json(c.get('ctx').settings.get()))

settingsRoutes.patch('/', async (c) => {
  const { settings } = c.get('ctx')
  const raw = await c.req.json().catch(() => null)
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'invalid settings patch', details: parsed.error.flatten() }, 400)
  return c.json(settings.patch(parsed.data))
})
