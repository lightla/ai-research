'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { HistoryMatch, MergedFromEntry, MemoryRecord, PromotedInfo, Scope } from '@/lib/smem'
import { findPromotedRawIdsAction, searchHistoryAction } from '@/lib/actions'
import HistoryResultCard from './HistoryResultCard'
import MergeDock from './MergeDock'

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [promotedMap, setPromotedMap] = useState<Record<string, PromotedInfo>>({})
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const fetchPage = useCallback(
    (searchQuery: string, offset: number) =>
      searchHistoryAction(searchQuery, scope, projectId, offset, {
        ...(agentFilter ? { agent: agentFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {})
      }),
    [scope, projectId, agentFilter, kindFilter]
  )

  // A raw item stays in the list forever even once it's part of an official memory (see
  // PURPOSE.md: raw capture is an audit trail, never deleted by promotion) — so every fetched
  // page needs its own "already promoted?" lookup to know which cards get the badge.
  const loadPromotedStatus = useCallback(
    (matches: HistoryMatch[]) => {
      const ids = matches.map((m) => m.id)
      if (ids.length === 0) return
      findPromotedRawIdsAction(scope, projectId, ids).then((found) => {
        if (Object.keys(found).length > 0) {
          setPromotedMap((prev) => ({ ...prev, ...found }))
        }
      })
    },
    [scope, projectId]
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
        setSelectedIds(new Set())
        loadPromotedStatus(matches)
      })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, fetchPage, loadPromotedStatus])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || loading) return
    setLoadingMore(true)
    fetchPage(query, results.length).then((matches) => {
      setResults((prev) => [...prev, ...matches])
      setHasMore(matches.length === PAGE_SIZE)
      setLoadingMore(false)
      loadPromotedStatus(matches)
    })
  }, [fetchPage, query, results.length, loadingMore, hasMore, loading, loadPromotedStatus])

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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handlePromoted = (id: string, info: PromotedInfo) => {
    setPromotedMap((prev) => ({ ...prev, [id]: info }))
  }

  const handleMerged = (sources: MergedFromEntry[], memory: MemoryRecord) => {
    const info: PromotedInfo = {
      memoryId: memory.id,
      ...(memory.title ? { title: memory.title } : {}),
      type: memory.type,
      content: memory.content
    }
    setPromotedMap((prev) => {
      const next = { ...prev }
      for (const source of sources) next[source.id] = info
      return next
    })
    setSelectedIds(new Set())
  }

  const selectedMatches = results.filter((m) => selectedIds.has(m.id))

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
      <div className="flex items-center gap-2 mb-2 flex-wrap">
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
        Lịch sử (raw){scope === 'local' ? ' theo project này' : ' toàn bộ global'} — tick chọn nhiều tin nhắn để gộp
        thành 1 tri thức nếu nó trải dài qua nhiều message. Bản nháp gộp nằm ngay dưới danh sách — tick thêm lúc nào
        cũng được, không cần đóng lại.
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
                selected={selectedIds.has(match.id)}
                onToggleSelect={toggleSelect}
                promoted={promotedMap[match.id]}
                onPromoted={handlePromoted}
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

      {selectedMatches.length > 0 && (
        <MergeDock
          matches={selectedMatches}
          scope={scope}
          projectId={projectId}
          onCancel={() => setSelectedIds(new Set())}
          onMerged={handleMerged}
        />
      )}
    </div>
  )
}
