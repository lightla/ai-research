'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Save, X } from 'lucide-react'
import type { HistoryMatch, MemoryRecord, MergedFromEntry, Scope } from '@/lib/smem'
import { mergeHistoryAction } from '@/lib/actions'

const TYPES = ['decision', 'context', 'todo', 'preference', 'error', 'note'] as const

interface Props {
  // Live selection from the parent — as the user ticks more checkboxes in the list behind this
  // dock, this array grows and the dock picks it up via the effect below. Unlike a blocking
  // modal, the list stays fully visible/clickable, so "merge in 1 more while editing" just works.
  matches: HistoryMatch[]
  scope: Scope
  projectId: string | null
  onCancel: () => void
  onMerged: (sources: MergedFromEntry[], memory: MemoryRecord) => void
}

function labelFor(match: HistoryMatch): string {
  const parts = [match.agent, match.timestamp].filter(Boolean)
  return parts.length > 0 ? `[${parts.join(' · ')}]` : `[${match.id}]`
}

export default function MergeDock({ matches, scope, projectId, onCancel, onMerged }: Props) {
  const [isPending, startTransition] = useTransition()
  const [type, setType] = useState<(typeof TYPES)[number]>('context')
  const [title, setTitle] = useState('')
  const [namespace, setNamespace] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [content, setContent] = useState(() => matches.map((m) => `${labelFor(m)}\n${m.content}`).join('\n\n'))
  // What's already been folded into `content`, so a newly-ticked item gets appended exactly
  // once and an unticked one doesn't silently vanish from text the user may have already edited.
  const syncedIdsRef = useRef(new Set(matches.map((m) => m.id)))
  const [justAdded, setJustAdded] = useState<string | null>(null)

  useEffect(() => {
    const added = matches.filter((m) => !syncedIdsRef.current.has(m.id))
    if (added.length > 0) {
      setContent((prev) => {
        const appended = added.map((m) => `${labelFor(m)}\n${m.content}`).join('\n\n')
        return prev.trim() ? `${prev}\n\n${appended}` : appended
      })
      setJustAdded(added.length === 1 ? added[0]!.id : `${added.length} tin nhắn`)
      const timer = setTimeout(() => setJustAdded(null), 2000)
      syncedIdsRef.current = new Set(matches.map((m) => m.id))
      return () => clearTimeout(timer)
    }
    syncedIdsRef.current = new Set(matches.map((m) => m.id))
  }, [matches])

  const handleSave = () => {
    if (!content.trim()) return
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    const sources: MergedFromEntry[] = matches.map((m) => ({ id: m.id, kind: m.kind }))
    startTransition(async () => {
      const memory = await mergeHistoryAction(scope, projectId, sources, {
        type,
        namespace: namespace.trim() || null,
        title,
        content,
        tags,
      })
      onMerged(sources, memory)
    })
  }

  return (
    <div
      className="sticky bottom-0 mt-3 rounded-lg shadow-lg"
      style={{ background: 'var(--bg)', border: '1.5px solid var(--accent)', zIndex: 10 }}
    >
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1.5px solid var(--border)' }}>
        <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>
          Gộp {matches.length} tin nhắn thành 1 tri thức — tick thêm ở danh sách bên trên để bổ sung vào bản nháp
        </span>
        <button onClick={onCancel} style={{ color: 'var(--muted)' }}>
          <X size={14} />
        </button>
      </div>

      <div className="p-3">
        {justAdded && (
          <p className="text-[11px] font-mono mb-2" style={{ color: 'var(--accent)' }}>
            ✓ Đã thêm {justAdded} vào bản nháp
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="px-1.5 py-1 rounded border text-xs font-mono bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="Namespace (optional)"
            className="flex-1 min-w-[140px] px-2 py-1 rounded border text-xs bg-transparent outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="flex-1 min-w-[140px] px-2 py-1 rounded border text-xs bg-transparent outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="tags, comma, separated"
            className="flex-1 min-w-[140px] px-2 py-1 rounded border text-xs bg-transparent outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          className="w-full text-xs font-mono p-2 rounded outline-none"
          style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
        />

        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleSave}
            disabled={isPending || !content.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-mono font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <Save size={12} /> Lưu thành official
          </button>
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded font-mono"
            style={{ border: '1.5px solid var(--border)', color: 'var(--muted)' }}
          >
            Hủy
          </button>
        </div>
      </div>
    </div>
  )
}
