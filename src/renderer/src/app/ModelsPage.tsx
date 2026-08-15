import { Boxes } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export function ModelsPage(): React.JSX.Element {
  return (
    <EmptyState
      icon={Boxes}
      title="Models"
      description="Installed models, the Qualcomm AI Hub catalogue and Hugging Face GGUF imports. Coming in a later milestone."
    />
  )
}
