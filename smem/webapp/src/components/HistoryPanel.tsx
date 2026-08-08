'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { HistoryMatch, Scope } from '@/lib/smem'
import { searchHistoryAction } from '@/lib/actions'
import HistoryResultCard from './HistoryResultCard'

const PAGE_SIZE = 20

const AGENTS = ['codex', 'claude-code', 'antigravity', 'opencode'] as const
const KINDS = ['raw-input', 'raw-output', 'tool-event', 'raw-event'] as const

interface Props {
  scope: Scope
  projectId: string | null
}

function FilterSelect({
  value,
  onChange,
  options,
  allLabel
}: {
  value: string
  onChange: (value: string) => void
  options: readonly string[]
  allLabel: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1.5 rounded-lg text-xs font-mono outline-none"
      style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', color: value ? 'var(--text)' : 'var(--muted)' }}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  )
}

export default function HistoryPanel({ scope, projectId }: Props) {
  const [query, setQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [results, setResults] = useState<HistoryMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const fetchPage = useCallback(
    (searchQuery: string, offset: number) =>
      searchHistoryAction(searchQuery, scope, projectId, offset, {
        ...(agentFilter ? { agent: agentFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {})
      }),
    [scope, projectId, agentFilter, kindFilter]
  )

  // Reset and load the first page whenever the (debounced) query, filters, scope, or project change.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      fetchPage(query, 0).then((matches) => {
        if (cancelled) return
        setResults(matches)
        setHasMore(matches.length === PAGE_SIZE)
        setLoading(false)
      })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, fetchPage])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || loading) return
    setLoadingMore(true)
    fetchPage(query, results.length).then((matches) => {
      setResults((prev) => [...prev, ...matches])
      setHasMore(matches.length === PAGE_SIZE)
      setLoadingMore(false)
    })
  }, [fetchPage, query, results.length, loadingMore, hasMore, loading])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  return (
    <div>
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-2" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}>
        <Search size={14} style={{ color: 'var(--muted)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm trong lịch sử, để trống để xem tất cả..."
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: 'var(--text)' }}
        />
        {query && (
          <button onClick={() => setQuery('')} style={{ color: 'var(--muted)' }}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <FilterSelect value={agentFilter} onChange={setAgentFilter} options={AGENTS} allLabel="Mọi agent" />
        <FilterSelect value={kindFilter} onChange={setKindFilter} options={KINDS} allLabel="Mọi loại capture" />
        {(agentFilter || kindFilter) && (
          <button
            onClick={() => {
              setAgentFilter('')
              setKindFilter('')
            }}
            className="text-xs font-mono px-2 py-1 rounded"
            style={{ color: 'var(--muted)', border: '1.5px solid var(--border)' }}
          >
            Xoá filter
          </button>
        )}
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
        Lịch sử (raw){scope === 'local' ? ' theo project này' : ' toàn bộ global'}
      </p>

      {loading ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--muted)' }}>
          Đang tìm...
        </p>
      ) : results.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--muted)' }}>
          Không tìm thấy gì trong lịch sử hội thoại.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {results.map((match) => (
              <HistoryResultCard
                key={match.id}
                match={match}
                scope={scope}
                projectId={projectId}
                onDeleted={(id) => setResults((prev) => prev.filter((m) => m.id !== id))}
                onUpdated={(oldId, updated) =>
                  setResults((prev) => prev.map((m) => (m.id === oldId ? updated : m)))
                }
              />
            ))}
          </ul>
          <div ref={sentinelRef} className="h-px" />
          {loadingMore && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--muted)' }}>
              Đang tải thêm...
            </p>
          )}
          {!hasMore && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--muted)' }}>
              — hết —
            </p>
          )}
        </>
      )}
    </div>
  )
}
