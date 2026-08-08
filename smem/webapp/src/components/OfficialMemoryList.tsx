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
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [nsFilter, setNsFilter] = useState<string | null>(null)
  const [showAllStatuses, setShowAllStatuses] = useState(false)

  const visible = useMemo(
    () => memories.filter((m) => (showAllStatuses ? true : m.status === 'active')),
    [memories, showAllStatuses]
  )

  const nsed = useMemo(
    () => (nsFilter ? visible.filter((m) => m.namespace === nsFilter) : visible),
    [visible, nsFilter]
  )

  const typed = useMemo(
    () => (typeFilter ? nsed.filter((m) => m.type === typeFilter) : nsed),
    [nsed, typeFilter]
  )

  const tagged = useMemo(
    () => (tagFilter ? typed.filter((m) => m.tags.includes(tagFilter)) : typed),
    [typed, tagFilter]
  )

  const allTags = useMemo(() => {
    const set = new Set<string>()
    typed.forEach((m) => m.tags.forEach((t) => set.add(t)))
    return [...set].sort()
  }, [typed])

  const allNamespaces = useMemo(() => {
    const set = new Set<string>()
    visible.forEach((m) => {
      if (m.namespace) set.add(m.namespace)
    })
    return [...set].sort()
  }, [visible])

  const fuse = useMemo(
    () =>
      new Fuse(tagged, {
        keys: [
          { name: 'namespace', weight: 4 },
          { name: 'title', weight: 3 },
          { name: 'tags', weight: 2 },
          { name: 'content', weight: 1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [tagged]
  )

  const results = query.trim() ? fuse.search(query).map((r) => r.item) : tagged

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

      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs font-mono">
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

      {allNamespaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs font-mono" style={{ borderTop: '1px dashed var(--border)', paddingTop: '8px' }}>
          <span style={{ color: 'var(--muted)' }}>namespaces:</span>
          <button
            onClick={() => setNsFilter(null)}
            className="px-2 py-0.5 rounded border"
            style={{
              borderColor: nsFilter === null ? 'var(--accent)' : 'var(--border)',
              color: nsFilter === null ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            all
          </button>
          {allNamespaces.map((ns) => (
            <button
              key={ns}
              onClick={() => setNsFilter(nsFilter === ns ? null : ns)}
              className="px-2 py-0.5 rounded border"
              style={{
                borderColor: nsFilter === ns ? 'var(--accent)' : 'var(--border)',
                color: nsFilter === ns ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              ns:{ns}
            </button>
          ))}
        </div>
      )}

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4 text-xs font-mono" style={{ borderTop: '1px dashed var(--border)', paddingTop: '8px' }}>
          <span style={{ color: 'var(--muted)' }}>tags:</span>
          <button
            onClick={() => setTagFilter(null)}
            className="px-2 py-0.5 rounded border"
            style={{
              borderColor: tagFilter === null ? 'var(--accent)' : 'var(--border)',
              color: tagFilter === null ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            all
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className="px-2 py-0.5 rounded border"
              style={{
                borderColor: tagFilter === tag ? 'var(--accent)' : 'var(--border)',
                color: tagFilter === tag ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

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
                  {memory.namespace && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setNsFilter(nsFilter === memory.namespace ? null : (memory.namespace ?? null))
                      }}
                      className="text-xs font-mono px-1.5 py-0.5 rounded font-bold transition hover:border-accent"
                      style={{
                        background: 'var(--bg)',
                        color: nsFilter === memory.namespace ? 'var(--accent)' : 'var(--text)',
                        border: `1px solid ${nsFilter === memory.namespace ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      ns:{memory.namespace}
                    </button>
                  )}
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
                      <button
                        key={tag}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setTagFilter(tagFilter === tag ? null : tag)
                        }}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded transition hover:border-accent"
                        style={{
                          background: 'var(--bg)',
                          color: tagFilter === tag ? 'var(--accent)' : 'var(--muted)',
                          border: `1px solid ${tagFilter === tag ? 'var(--accent)' : 'var(--border)'}`,
                        }}
                      >
                        #{tag}
                      </button>
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
