import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { StoredMessage } from '@shared/chat'
import type { StudioSettings } from '@shared/settings'
import type { ComputeUnit } from '@shared/config'
import { pickAutoModel } from '@shared/modelSelect'
import { api } from '@/lib/api'
import { useChatStore } from '@/stores/chatStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useServerStore } from '@/stores/serverStore'
import { MessageList } from './MessageList'
import { Composer, type ComposerSettings } from './Composer'
import { useKnowledgeStore } from '@/stores/knowledgeStore'
import { useSidecarStore } from '@/stores/sidecarStore'
import { ChatEmpty } from './ChatEmpty'
import { ContextMeter } from './ContextMeter'

export function ChatView(): React.JSX.Element {
  const activeId = useChatStore((s) => s.activeId)
  const messages = useChatStore((s) => s.messages)
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId) ?? null)
  const stream = useChatStore((s) => (s.activeId ? (s.streams[s.activeId] ?? null) : null))
  const promptInfo = useChatStore((s) => (s.activeId ? (s.promptInfo[s.activeId] ?? null) : null))
  const pendingAttachments = useChatStore((s) => s.pendingAttachments)
  const draft = useChatStore((s) => s.draft)
  const setDraft = useChatStore((s) => s.setDraft)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const uploadFiles = useChatStore((s) => s.uploadFiles)
  const addPathAttachments = useChatStore((s) => s.addPathAttachments)
  const removePendingAttachment = useChatStore((s) => s.removePendingAttachment)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const storeError = useChatStore((s) => s.error)
  const agentLive = useChatStore((s) => (s.activeId ? (s.agent[s.activeId] ?? null) : null))
  const respondApproval = useChatStore((s) => s.respondApproval)

  const installed = useModelsStore((s) => s.installed)
  const findModel = useModelsStore((s) => s.find)
  const genie = useServerStore((s) => s.genie)

  const [defaults, setDefaults] = useState<StudioSettings | null>(null)
  useEffect(() => {
    void api<StudioSettings>('/api/settings').then(setDefaults).catch(() => {})
  }, [])

  // Model + per-conversation settings (fall back to Studio defaults for a not-yet-created chat).
  const [localModel, setLocalModel] = useState<string | null>(null)
  const [localSettings, setLocalSettings] = useState<Partial<ComposerSettings>>({})
  const [localMode, setLocalMode] = useState<'chat' | 'agent' | null>(null)
  useEffect(() => {
    setLocalModel(null)
    setLocalSettings({})
    setLocalMode(null)
  }, [activeId])
  const mode: 'chat' | 'agent' = localMode ?? conversation?.mode ?? 'chat'
  const workspaceRoot = conversation?.workspaceRoot ?? defaults?.workspace.root ?? null
  const onModeChange = useCallback(
    (m: 'chat' | 'agent') => {
      setLocalMode(m)
      if (activeId) void updateConversation(activeId, { mode: m })
    },
    [activeId, updateConversation],
  )
  const onPickWorkspace = useCallback(async () => {
    if (!window.studio?.showOpenDialog) return
    const paths = await window.studio.showOpenDialog({ title: 'Choose the agent workspace folder', properties: ['openDirectory'] })
    if (!paths[0]) return
    if (activeId) await updateConversation(activeId, { workspaceRoot: paths[0] })
    else await api('/api/settings', { method: 'PATCH', json: { workspace: { root: paths[0] } } })
    setDefaults((d) => (d ? { ...d, workspace: { ...d.workspace, root: paths[0] } } : d))
  }, [activeId, updateConversation])

  // Same auto-pick the server would make (@shared/modelSelect): the composer has to *show* a model before the
  // turn is sent, and it sends that model explicitly — so a naive `installed[0]` fallback here would silently
  // bypass the crash avoidance and walk straight back into a model known to kill the runtime.
  const autoModel = useMemo(
    () => pickAutoModel(installed, { crashed: genie?.crashedModels, preferred: (mode === 'agent' ? defaults?.defaults.agentModel : null) ?? defaults?.defaults.chatModel }),
    [installed, genie?.crashedModels, defaults?.defaults.agentModel, defaults?.defaults.chatModel, mode],
  )
  const model = localModel ?? conversation?.model ?? autoModel
  const modelInfo = findModel(model)
  const composerSettings: ComposerSettings = useMemo(
    () => ({
      enableThink: localSettings.enableThink ?? conversation?.settings.enableThink ?? defaults?.defaults.enableThink ?? true,
      compute: (localSettings.compute ?? conversation?.settings.options?.compute ?? defaults?.defaults.computeGguf ?? 'npu') as ComputeUnit,
      specType: localSettings.specType !== undefined ? localSettings.specType : (conversation?.settings.options?.spec_type ?? null),
      sampler: localSettings.sampler ?? conversation?.settings.sampler ?? defaults?.defaults.sampler ?? {},
      knowledge: localSettings.knowledge ?? conversation?.settings.knowledge?.enabled ?? false,
    }),
    [conversation, defaults, localSettings],
  )

  // Knowledge availability for the composer badge: sidecar embeddings feature + at least one indexed source.
  const sidecarStatus = useSidecarStore((s) => s.status)
  const knowledgeSourcesReady = useKnowledgeStore((s) => s.ready)
  const knowledgeLoaded = useKnowledgeStore((s) => s.loaded)
  const refreshKnowledge = useKnowledgeStore((s) => s.refresh)
  useEffect(() => {
    if (composerSettings.knowledge && !knowledgeLoaded) void refreshKnowledge()
  }, [composerSettings.knowledge, knowledgeLoaded, refreshKnowledge])
  const knowledgeReady: boolean | null = sidecarStatus?.state === 'running' && sidecarStatus.features?.embeddings ? knowledgeSourcesReady : null

  const persistSettings = useCallback(
    (patch: Partial<ComposerSettings>) => {
      setLocalSettings((s) => ({ ...s, ...patch }))
      if (activeId && conversation) {
        const settings = { ...conversation.settings }
        if (patch.enableThink !== undefined) settings.enableThink = patch.enableThink
        if (patch.compute !== undefined) settings.options = { ...(settings.options ?? {}), compute: patch.compute }
        if (patch.specType !== undefined) settings.options = { ...(settings.options ?? {}), spec_type: patch.specType ?? undefined }
        if (patch.sampler !== undefined) settings.sampler = patch.sampler
        if (patch.knowledge !== undefined) settings.knowledge = { ...(settings.knowledge ?? {}), enabled: patch.knowledge }
        void updateConversation(activeId, { settings })
      }
    },
    [activeId, conversation, updateConversation],
  )

  const onModelChange = useCallback(
    (id: string) => {
      setLocalModel(id)
      if (activeId) void updateConversation(activeId, { model: id })
    },
    [activeId, updateConversation],
  )

  const busy = (!!stream && stream.phase !== 'done' && stream.phase !== 'idle') || !!(agentLive?.run && (agentLive.run.status === 'running' || agentLive.run.status === 'waiting_approval'))
  const [editing, setEditing] = useState<{ id: string; preview: string } | null>(null)
  const draftBeforeEdit = useRef<string>('')

  const doSend = useCallback(
    (text: string) => {
      const options = { enable_think: composerSettings.enableThink, ...(modelInfo?.runtime !== 'qairt' ? { compute: composerSettings.compute, spec_type: composerSettings.specType ?? undefined } : {}) }
      void send({ text, mode, model: model ?? undefined, sampler: composerSettings.sampler, options, editMessageId: editing?.id, knowledge: { enabled: composerSettings.knowledge } })
      if (editing) setEditing(null)
    },
    [composerSettings, editing, mode, model, modelInfo?.runtime, send],
  )

  const onRegenerate = useCallback(() => {
    if (busy) return
    const options = { enable_think: composerSettings.enableThink, ...(modelInfo?.runtime !== 'qairt' ? { compute: composerSettings.compute, spec_type: composerSettings.specType ?? undefined } : {}) }
    void send({ text: '', regenerate: true, model: model ?? undefined, sampler: composerSettings.sampler, options, knowledge: { enabled: composerSettings.knowledge } })
  }, [busy, composerSettings, model, modelInfo?.runtime, send])

  const onEdit = useCallback(
    (m: StoredMessage) => {
      const text = typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')
      draftBeforeEdit.current = draft
      setEditing({ id: m.id, preview: text.slice(0, 60) })
      setDraft(text)
    },
    [draft, setDraft],
  )

  const onCommand = useCallback(
    (cmd: string, arg: string): boolean => {
      switch (cmd) {
        case '/think':
          persistSettings({ enableThink: arg ? /^(on|true|1|yes)$/i.test(arg) : !composerSettings.enableThink })
          return true
        case '/compute':
          if (/^(npu|hybrid|gpu|cpu)$/i.test(arg)) persistSettings({ compute: arg.toLowerCase() as ComputeUnit })
          return true
        case '/spec':
          if (/^(off|none|0|false)$/i.test(arg) || !arg) persistSettings({ specType: null })
          else if (/^(ngram-(cache|simple|map-k|map-k4v|mod)|draft-\w+)$/i.test(arg)) persistSettings({ specType: arg.toLowerCase() })
          return true
        case '/temp':
          if (arg && !Number.isNaN(Number(arg))) persistSettings({ sampler: { ...composerSettings.sampler, temperature: Number(arg) } })
          return true
        case '/max':
          if (arg && !Number.isNaN(Number(arg))) persistSettings({ sampler: { ...composerSettings.sampler, max_tokens: Number(arg) } })
          return true
        case '/system':
          if (activeId) void updateConversation(activeId, { systemPrompt: arg || null })
          return true
        case '/knowledge':
          persistSettings({ knowledge: arg ? /^(on|true|1|yes)$/i.test(arg) : !composerSettings.knowledge })
          return true
        case '/regenerate':
          onRegenerate()
          return true
        default:
          return false
      }
    },
    [activeId, composerSettings, onRegenerate, persistSettings, updateConversation],
  )

  const onPickFiles = useCallback(async () => {
    if (window.studio?.showOpenDialog) {
      const paths = await window.studio.showOpenDialog({
        title: 'Attach files',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Images & audio', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'wav', 'mp3', 'm4a', 'flac', 'ogg'] },
          { name: 'All files', extensions: ['*'] },
        ],
      })
      if (paths.length) await addPathAttachments(paths)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*,audio/*,.txt,.md,.pdf'
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (files.length) void uploadFiles(files)
    }
    input.click()
  }, [addPathAttachments, uploadFiles])

  const serverDown = genie && genie.state !== 'running' && genie.state !== 'starting'
  const disabledReason = !installed.length && !useModelsStore.getState().loading ? 'Install a model first (Models page)' : serverDown && !genie?.cliFound ? 'GenieX CLI not found — set its path in Settings' : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(storeError || (genie?.lastCrash && Date.now() - genie.lastCrash.at < 60_000)) && (
        <div className="mx-auto mt-3 flex w-full max-w-[var(--q-prose-max)] items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning hairline-subtle">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{storeError ?? `GenieX runtime restarted after a crash (exit ${genie!.lastCrash!.code}${genie!.lastCrash!.model ? ` while loading ${genie!.lastCrash!.model}` : ''}).`}</span>
        </div>
      )}
      {messages.length === 0 && !busy ? (
        <div className="min-h-0 flex-1">
          <ChatEmpty hasModels={installed.length > 0} isVlm={modelInfo?.type === 'vlm'} onPick={(p) => setDraft(p)} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          stream={stream}
          agent={agentLive}
          onEdit={onEdit}
          onRegenerate={onRegenerate}
          onDecide={(r, d) => respondApproval(r.id, d)}
          header={promptInfo && promptInfo.droppedHistory > 0 ? <div className="mb-3 rounded-md bg-surface-2 px-3 py-1.5 text-center text-xs text-text-secondary hairline-subtle">{promptInfo.droppedHistory} older message(s) were left out to fit the model's context window.</div> : null}
        />
      )}
      <ContextMeter promptInfo={promptInfo} stream={stream} conversation={conversation} modelInfo={modelInfo} />
      <Composer
        model={model}
        modelInfo={modelInfo}
        onModelChange={onModelChange}
        settings={composerSettings}
        onSettingsChange={persistSettings}
        attachments={pendingAttachments}
        onRemoveAttachment={(id) => void removePendingAttachment(id)}
        onFiles={(files) => void uploadFiles(files)}
        onPickFiles={() => void onPickFiles()}
        busy={busy}
        onSend={doSend}
        knowledgeReady={knowledgeReady}
        onStop={() => void stop()}
        onCommand={onCommand}
        draft={draft}
        onDraftChange={setDraft}
        editing={editing}
        onCancelEdit={() => {
          setEditing(null)
          setDraft(draftBeforeEdit.current)
        }}
        disabledReason={disabledReason}
        mode={mode}
        onModeChange={onModeChange}
        workspaceRoot={workspaceRoot}
        onPickWorkspace={() => void onPickWorkspace()}
      />
    </div>
  )
}
