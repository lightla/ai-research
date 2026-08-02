import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getProject, listMemories } from '@/lib/smem'
import MemoryWorkspace from '@/components/MemoryWorkspace'

export const dynamic = 'force-dynamic'

export default function ProjectMemoriesPage({ params }: { params: { projectId: string } }) {
  const project = getProject(params.projectId)
  if (!project) notFound()

  const memories = listMemories('local', params.projectId)

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-mono mb-4" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={12} /> ALL PROJECTS
      </Link>
      <h1 className="text-xl font-bold mb-1">{project.projectName}</h1>
      <p className="text-xs mb-6 font-mono" style={{ color: 'var(--muted)' }}>{project.rootPath}</p>
      <MemoryWorkspace memories={memories} scope="local" projectId={params.projectId} />
    </div>
  )
}
