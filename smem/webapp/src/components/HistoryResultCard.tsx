'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Edit, Save, Trash2, X } from 'lucide-react'
import type { HistoryMatch, Scope } from '@/lib/smem'
import { deleteHistoryAction, promoteHistoryAction, updateHistoryAction } from '@/lib/actions'
import MarkdownRenderer from './MarkdownRenderer'
import { wrapIfCodeLike } from '@/lib/markdown'

const TYPES = ['decision', 'context', 'todo', 'preference', 'error', 'note'] as const

interface Props {
  match: HistoryMatch
  scope: Scope
  projectId: string | null
  onDeleted: (id: string) => void
  onUpdated: (oldId: string, updated: HistoryMatch) => void
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
      style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}
    >
      {children}
    </span>
  )
}

export default function HistoryResultCard({ match, scope, projectId, onDeleted, onUpdated }: Props) {
  const [isPending, startTransition] = useTransition()
  const [promoting, setPromoting] = useState(false)
  const [promoted, setPromoted] = useState(false)
  const [type, setType] = useState<(typeof TYPES)[number]>('note')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState(match.content)
  const [tagsInput, setTagsInput] = useState('')

  const handleDelete = () => {
    if (!confirm('Xoá vĩnh viễn mục này khỏi lịch sử? Không thể hoàn tác.')) return
    startTransition(async () => {
      const ok = await deleteHistoryAction(match.kind, match.id)
      if (ok) onDeleted(match.id)
    })
  }

  const handleSaveRaw = () => {
    startTransition(async () => {
      const updated = await updateHistoryAction(match.id, content)
      if (updated) {
        onUpdated(match.id, updated)
      }
    })
  }

  const handlePromote = () => {
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    startTransition(async () => {
      await promoteHistoryAction(scope, projectId, { type, title, content, tags })
      setPromoting(false)
      setPromoted(true)
    })
  }

  return (
    <li className="px-4 py-3 rounded-lg" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Tag>{match.kind}</Tag>
        {match.recordKind && <Tag>{match.recordKind}</Tag>}
        {match.eventName && <Tag>{match.eventName}</Tag>}
        {match.agent && <Tag>{match.agent}</Tag>}
        {match.timestamp && <Tag>{match.timestamp}</Tag>}
        <Tag>{match.id}</Tag>

        <div className="ml-auto flex items-center gap-2">
          {promoted ? (
            <span className="flex items-center gap-1 text-xs font-mono" style={{ color: 'var(--accent)' }}>
              <CheckCircle2 size={12} /> đã lưu thành official
            </span>
          ) : (
            <button
              onClick={() => setPromoting((v) => !v)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded font-mono"
              style={{ border: '1.5px solid var(--accent)', color: 'var(--accent)' }}
            >
              <Edit size={11} /> Edit
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="text-xs px-2 py-1 rounded font-mono flex items-center gap-1"
            style={{ border: '1.5px solid #c0392b', color: '#c0392b' }}
          >
            <Trash2 size={11} /> Xoá
          </button>
        </div>
      </div>

      {promoting ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="flex-1 min-w-[160px] px-2 py-1 rounded border text-xs bg-transparent outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="tags, comma, separated"
              className="flex-1 min-w-[160px] px-2 py-1 rounded border text-xs bg-transparent outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full text-xs font-mono p-2 rounded outline-none"
            style={{ background: 'var(--bg)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleSaveRaw}
              disabled={isPending}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Save size={12} /> Lưu thay đổi
            </button>
            <button
              onClick={handlePromote}
              disabled={isPending}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono"
              style={{ border: '1.5px solid var(--accent)', color: 'var(--accent)' }}
            >
              <Save size={12} /> Lưu thành official
            </button>
            <button
              onClick={() => setPromoting(false)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono"
              style={{ border: '1.5px solid var(--border)', color: 'var(--muted)' }}
            >
              <X size={12} /> CANCEL
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs">
          <MarkdownRenderer content={wrapIfCodeLike(match.content)} />
        </div>
      )}
    </li>
  )
}
