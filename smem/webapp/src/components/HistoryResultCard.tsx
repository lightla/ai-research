'use client'

import { useState, useTransition, useEffect } from 'react'
import { Edit, Save, Trash2, X } from 'lucide-react'
import type { HistoryMatch, MergedFromEntry, PromotedInfo, Scope } from '@/lib/smem'
import { deleteHistoryAction, promoteHistoryAction, updateHistoryAction } from '@/lib/actions'
import MarkdownRenderer from './MarkdownRenderer'
import PromotedBadge from './PromotedBadge'
import { wrapIfCodeLike } from '@/lib/markdown'

const TYPES = ['decision', 'context', 'todo', 'preference', 'error', 'note'] as const

interface Props {
  match: HistoryMatch
  scope: Scope
  projectId: string | null
  selected: boolean
  onToggleSelect: (id: string) => void
  promoted?: PromotedInfo
  onPromoted: (id: string, info: PromotedInfo) => void
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

export default function HistoryResultCard({
  match,
  scope,
  projectId,
  selected,
  onToggleSelect,
  promoted,
  onPromoted,
  onDeleted,
  onUpdated
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [promoting, setPromoting] = useState(false)
  const [type, setType] = useState<(typeof TYPES)[number]>((match.type as any) || 'note')
  const [namespace, setNamespace] = useState(match.namespace || '')
  const [title, setTitle] = useState(match.title || '')
  const [content, setContent] = useState(match.content)
  const [tagsInput, setTagsInput] = useState(match.tags ? match.tags.join(', ') : '')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const selected = params.get('selected')
    if (selected === match.id) {
      setPromoting(true)
      setTimeout(() => {
        const el = document.getElementById(match.id)
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }, 150)
    }
  }, [match.id])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const selected = params.get('selected')
    if (promoting) {
      if (selected !== match.id) {
        params.set('selected', match.id)
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
      }
    } else {
      if (selected === match.id) {
        params.delete('selected')
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
      }
    }
  }, [promoting, match.id])

  const handleDelete = () => {
    if (!confirm('Xoá vĩnh viễn mục này khỏi lịch sử? Không thể hoàn tác.')) return
    startTransition(async () => {
      const ok = await deleteHistoryAction(match.kind, match.id)
      if (ok) onDeleted(match.id)
    })
  }

  const handleSaveRaw = () => {
    const origTags = match.tags ? match.tags.join(', ') : ''
    if (
      content === match.content &&
      type === ((match.type as any) || 'note') &&
      namespace === (match.namespace || '') &&
      title === (match.title || '') &&
      tagsInput === origTags
    ) {
      setPromoting(false)
      return
    }
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    startTransition(async () => {
      try {
        const updated = await updateHistoryAction(match.id, content, {
          type,
          namespace: namespace.trim() || null,
          title: title.trim() || null,
          tags
        })
        if (updated) {
          onUpdated(match.id, updated)
          setPromoting(false)
        } else {
          alert("Không thể lưu: Định dạng bản ghi này không hỗ trợ sửa đổi nội dung trực tiếp.")
        }
      } catch (error) {
        console.error(error)
        alert("Lỗi kết nối hoặc định dạng bản ghi không hỗ trợ chỉnh sửa.")
      }
    })
  }

  const handlePromote = () => {
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    const source: MergedFromEntry = { id: match.id, kind: match.kind }
    startTransition(async () => {
      const memory = await promoteHistoryAction(
        scope,
        projectId,
        { type, namespace: namespace.trim() || null, title, content, tags },
        source
      )
      setPromoting(false)
      onPromoted(match.id, {
        memoryId: memory.id,
        ...(memory.title ? { title: memory.title } : {}),
        type: memory.type,
        content: memory.content
      })
    })
  }

  return (
    <li id={match.id} className="px-4 py-3 rounded-lg" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(match.id)}
          title="Chọn để gộp với các tin nhắn khác"
          className="mr-0.5"
        />
        <Tag>{match.kind}</Tag>
        {match.recordKind && <Tag>{match.recordKind}</Tag>}
        {match.eventName && <Tag>{match.eventName}</Tag>}
        {match.agent && <Tag>{match.agent}</Tag>}
        {match.timestamp && <Tag>{match.timestamp}</Tag>}
        {match.namespace && <Tag>ns:{match.namespace}</Tag>}
        <Tag>{match.id}</Tag>
        {promoted && <PromotedBadge info={promoted} scope={scope} projectId={projectId} />}

        <div className="ml-auto flex items-center gap-2">
          {!promoted && (
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
          {match.title && <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>{match.title}</div>}
          <MarkdownRenderer content={wrapIfCodeLike(match.content)} />
          {match.tags && match.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {match.tags.map((tag) => (
                <span key={tag} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
