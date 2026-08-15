import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { StoredMessage } from '@shared/chat'
import type { StudioSettings } from '@shared/settings'
import type { ComputeUnit } from '@shared/config'
import { api } from '@/lib/api'
import { useChatStore } from '@/stores/chatStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useServerStore } from '@/stores/serverStore'
import { MessageList } from './MessageList'
import { Composer, type ComposerSettings } from './Composer'
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
  useEffect(() => {
    setLocalModel(null)
    setLocalSettings({})
  }, [activeId])

  const model = localModel ?? conversation?.model ?? defaults?.defaults.chatModel ?? installed[0]?.requestIds[0] ?? null
  const modelInfo = findModel(model)
  const composerSettings: ComposerSettings = useMemo(
    () => ({
      enableThink: localSettings.enableThink ?? conversation?.settings.enableThink ?? defaults?.defaults.enableThink ?? true,
      compute: (localSettings.compute ?? conversation?.settings.options?.compute ?? defaults?.defaults.computeGguf ?? 'hybrid') as ComputeUnit,
      sampler: localSettings.sampler ?? conversation?.settings.sampler ?? defaults?.defaults.sampler ?? {},
    }),
    [conversation, defaults, localSettings],
  )

  const persistSettings = useCallback(
    (patch: Partial<ComposerSettings>) => {
      setLocalSettings((s) => ({ ...s, ...patch }))
      if (activeId && conversation) {
        const settings = { ...conversation.settings }
        if (patch.enableThink !== undefined) settings.enableThink = patch.enableThink
        if (patch.compute !== undefined) settings.options = { ...(settings.options ?? {}), compute: patch.compute }
        if (patch.sampler !== undefined) settings.sampler = patch.sampler
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

  const busy = !!stream && stream.phase !== 'done' && stream.phase !== 'idle'
  const [editing, setEditing] = useState<{ id: string; preview: string } | null>(null)
  const draftBeforeEdit = useRef<string>('')

  const doSend = useCallback(
    (text: string) => {
      const options = { enable_think: composerSettings.enableThink, ...(modelInfo?.runtime !== 'qairt' ? { compute: composerSettings.compute } : {}) }
      void send({ text, model: model ?? undefined, sampler: composerSettings.sampler, options, editMessageId: editing?.id })
      if (editing) setEditing(null)
    },
    [composerSettings, editing, model, modelInfo?.runtime, send],
  )

  const onRegenerate = useCallback(() => {
    if (busy) return
    const options = { enable_think: composerSettings.enableThink, ...(modelInfo?.runtime !== 'qairt' ? { compute: composerSettings.compute } : {}) }
    void send({ text: '', regenerate: true, model: model ?? undefined, sampler: composerSettings.sampler, options })
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
        case '/temp':
          if (arg && !Number.isNaN(Number(arg))) persistSettings({ sampler: { ...composerSettings.sampler, temperature: Number(arg) } })
          return true
        case '/max':
          if (arg && !Number.isNaN(Number(arg))) persistSettings({ sampler: { ...composerSettings.sampler, max_tokens: Number(arg) } })
          return true
        case '/system':
          if (activeId) void updateConversation(activeId, { systemPrompt: arg || null })
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
          onEdit={onEdit}
          onRegenerate={onRegenerate}
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
      />
    </div>
  )
}
