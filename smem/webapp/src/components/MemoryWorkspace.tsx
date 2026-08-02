'use client'

import { useState } from 'react'
import type { MemoryRecord, Scope } from '@/lib/smem'
import OfficialMemoryList from './OfficialMemoryList'
import HistoryPanel from './HistoryPanel'

interface Props {
  memories: MemoryRecord[]
  scope: Scope
  projectId: string | null
}

type Tab = 'official' | 'history'

export default function MemoryWorkspace({ memories, scope, projectId }: Props) {
  const [tab, setTab] = useState<Tab>('official')

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <nav className="flex md:flex-col gap-1 md:w-36 flex-shrink-0">
        <button
          onClick={() => setTab('official')}
          className="text-left px-3 py-2 rounded text-sm font-mono"
          style={{
            background: tab === 'official' ? 'var(--surface)' : 'transparent',
            border: `1.5px solid ${tab === 'official' ? 'var(--accent)' : 'var(--border)'}`,
            color: tab === 'official' ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          Official
        </button>
        <button
          onClick={() => setTab('history')}
          className="text-left px-3 py-2 rounded text-sm font-mono"
          style={{
            background: tab === 'history' ? 'var(--surface)' : 'transparent',
            border: `1.5px solid ${tab === 'history' ? 'var(--accent)' : 'var(--border)'}`,
            color: tab === 'history' ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          History
        </button>
      </nav>

      <div className="flex-1 min-w-0">
        {tab === 'official' ? (
          <OfficialMemoryList memories={memories} scope={scope} projectId={projectId} />
        ) : (
          <HistoryPanel scope={scope} projectId={projectId} />
        )}
      </div>
    </div>
  )
}
