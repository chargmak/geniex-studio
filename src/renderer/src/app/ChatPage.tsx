import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useChatStore } from '@/stores/chatStore'
import { useModelsStore } from '@/stores/modelsStore'
import { ConversationList } from '@/components/chat/ConversationList'
import { ChatView } from '@/components/chat/ChatView'
import { ArtifactPanel } from '@/components/chat/ArtifactPanel'

export function ChatPage(): React.JSX.Element {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeId)
  const streams = useChatStore((s) => s.streams)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const select = useChatStore((s) => s.select)
  const createConversation = useChatStore((s) => s.createConversation)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const refreshModels = useModelsStore((s) => s.refresh)
  const streamingIds = useMemo(() => new Set(Object.keys(streams)), [streams])

  useEffect(() => {
    void loadConversations()
    void refreshModels()
  }, [loadConversations, refreshModels])

  // URL → store
  useEffect(() => {
    const id = conversationId ?? null
    if (id !== activeId) void select(id)
  }, [conversationId, activeId, select])

  // store → URL (a new chat gets created on first send)
  useEffect(() => {
    if (activeId && activeId !== conversationId) navigate(`/chat/${activeId}`, { replace: true })
  }, [activeId, conversationId, navigate])

  return (
    <div className="flex h-full min-h-0">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        streamingIds={streamingIds}
        onSelect={(id) => navigate(`/chat/${id}`)}
        onNew={() => {
          void createConversation().then((c) => navigate(`/chat/${c.id}`))
        }}
        onRename={(id, title) => void updateConversation(id, { title })}
        onDelete={(id) => {
          void deleteConversation(id).then(() => {
            if (id === activeId) navigate('/chat')
          })
        }}
        onTogglePin={(c) => void updateConversation(c.id, { pinned: !c.pinned })}
      />
      <div className="min-w-0 flex-1">
        <ChatView />
      </div>
      <ArtifactPanel />
    </div>
  )
}
