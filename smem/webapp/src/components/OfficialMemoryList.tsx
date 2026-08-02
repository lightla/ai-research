'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Fuse from 'fuse.js'
import { Search, X } from 'lucide-react'
import type { MemoryRecord, Scope } from '@/lib/smem'

interface Props {
  memories: MemoryRecord[]
  scope: Scope
  projectId: string | null
}

const TYPES = ['decision', 'context', 'todo', 'preference', 'error', 'note'] as const

function detailHref(scope: Scope, projectId: string | null, id: string): string {
  return scope === 'global' ? `/global/${id}` : `/p/${projectId}/${id}`
}

function excerpt(content: string, max = 160): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export default function OfficialMemoryList({ memories, scope, projectId }: Props) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [showAllStatuses, setShowAllStatuses] = useState(false)

  const visible = useMemo(
    () => memories.filter((m) => (showAllStatuses ? true : m.status === 'active')),
    [memories, showAllStatuses]
  )

  const typed = useMemo(
    () => (typeFilter ? visible.filter((m) => m.type === typeFilter) : visible),
    [visible, typeFilter]
  )

  const fuse = useMemo(
    () =>
      new Fuse(typed, {
        keys: [
          { name: 'title', weight: 3 },
          { name: 'tags', weight: 2 },
          { name: 'content', weight: 1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [typed]
  )

  const results = query.trim() ? fuse.search(query).map((r) => r.item) : typed

  return (
    <div>
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-4" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}>
        <Search size={14} style={{ color: 'var(--muted)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories..."
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: 'var(--text)' }}
        />
        {query && (
          <button onClick={() => setQuery('')} style={{ color: 'var(--muted)' }}>
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs font-mono">
        <button
          onClick={() => setTypeFilter(null)}
          className="px-2.5 py-1 rounded border"
          style={{
            borderColor: typeFilter === null ? 'var(--accent)' : 'var(--border)',
            color: typeFilter === null ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          all
        </button>
        {TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setTypeFilter(typeFilter === type ? null : type)}
            className="px-2.5 py-1 rounded border"
            style={{
              borderColor: typeFilter === type ? 'var(--accent)' : 'var(--border)',
              color: typeFilter === type ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            {type}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={showAllStatuses} onChange={(e) => setShowAllStatuses(e.target.checked)} />
          Hiện cả mục đã ẩn (archived/rejected/pending)
        </label>
      </div>

      {results.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--muted)' }}>
          No memories match.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((memory) => (
            <li key={memory.id}>
              <Link
                href={detailHref(scope, projectId, memory.id)}
                className="block px-4 py-3 rounded-lg hover:brightness-[0.98] transition"
                style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                    {memory.type}
                  </span>
                  {memory.status !== 'active' && (
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                      {memory.status}
                    </span>
                  )}
                  <span className="text-sm font-medium">{memory.title ?? memory.id}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  {excerpt(memory.content)}
                </p>
                {memory.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {memory.tags.map((tag) => (
                      <span key={tag} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
