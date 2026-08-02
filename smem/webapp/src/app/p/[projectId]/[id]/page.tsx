import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getMemory, getProject } from '@/lib/smem'
import MemoryDetail from '@/components/MemoryDetail'

export const dynamic = 'force-dynamic'

export default function ProjectMemoryDetailPage({ params }: { params: { projectId: string; id: string } }) {
  const project = getProject(params.projectId)
  if (!project) notFound()

  const memory = getMemory('local', params.projectId, params.id)
  if (!memory) notFound()

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link href={`/p/${params.projectId}`} className="inline-flex items-center gap-1.5 text-xs font-mono mb-4" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={12} /> {project.projectName.toUpperCase()}
      </Link>
      <MemoryDetail memory={memory} scope="local" projectId={params.projectId} />
    </div>
  )
}
