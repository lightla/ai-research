import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getMemory } from '@/lib/smem'
import MemoryDetail from '@/components/MemoryDetail'

export const dynamic = 'force-dynamic'

export default function GlobalMemoryDetailPage({ params }: { params: { id: string } }) {
  const memory = getMemory('global', null, params.id)
  if (!memory) notFound()

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/global" className="inline-flex items-center gap-1.5 text-xs font-mono mb-4" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={12} /> GLOBAL
      </Link>
      <MemoryDetail memory={memory} scope="global" projectId={null} />
    </div>
  )
}
