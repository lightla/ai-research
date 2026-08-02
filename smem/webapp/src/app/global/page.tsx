import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { listMemories } from '@/lib/smem'
import MemoryWorkspace from '@/components/MemoryWorkspace'

export const dynamic = 'force-dynamic'

export default function GlobalMemoriesPage() {
  const memories = listMemories('global', null)

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-mono mb-4" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={12} /> ALL PROJECTS
      </Link>
      <h1 className="text-xl font-bold mb-6">Global memories</h1>
      <MemoryWorkspace memories={memories} scope="global" projectId={null} />
    </div>
  )
}
