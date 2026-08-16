import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { AppShell } from '@/components/shell/AppShell'
import { ChatPage } from '@/app/ChatPage'
import { AgentsPage } from '@/app/AgentsPage'
import { StudioPage } from '@/app/StudioPage'
import { KnowledgePage } from '@/app/KnowledgePage'
import { ModelsPage } from '@/app/ModelsPage'
import { SystemPage } from '@/app/SystemPage'
import { SettingsPage } from '@/app/SettingsPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: 'chat/:conversationId?', element: <ChatPage /> },
      { path: 'agents/:runId?', element: <AgentsPage /> },
      { path: 'studio', element: <StudioPage /> },
      { path: 'knowledge', element: <KnowledgePage /> },
      { path: 'models', element: <ModelsPage /> },
      { path: 'system', element: <SystemPage /> },
      { path: 'settings/:section?', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/chat" replace /> },
    ],
  },
])

export function App(): React.JSX.Element {
  return <RouterProvider router={router} />
}
