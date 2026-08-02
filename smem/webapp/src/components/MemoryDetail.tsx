'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Braces, Edit, Save, Trash2, X } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import TableOfContents from './TableOfContents'
import { extractHeadings } from '@/lib/markdown'
import type { MemoryRecord, Scope } from '@/lib/smem'
import { archiveMemoryAction, removeMemoryAction, restoreMemoryAction, saveMemoryAction } from '@/lib/actions'

const TYPES = ['decision', 'context', 'todo', 'preference', 'error', 'note'] as const

interface Props {
  memory: MemoryRecord
  scope: Scope
  projectId: string | null
}

export default function MemoryDetail({ memory, scope, projectId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [type, setType] = useState(memory.type)
  const [title, setTitle] = useState(memory.title ?? '')
  const [content, setContent] = useState(memory.content)
  const [tagsInput, setTagsInput] = useState(memory.tags.join(', '))
  const [showRaw, setShowRaw] = useState(false)

  const headings = useMemo(() => extractHeadings(editing ? content : memory.content), [editing, content, memory.content])

  const isArchived = memory.status === 'archived'
  const canEdit = memory.status !== 'archived' && memory.status !== 'rejected'
  const canArchive = memory.status === 'active'
  const canRestore = memory.status === 'archived'

  const handleSave = () => {
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    startTransition(async () => {
      await saveMemoryAction(scope, projectId, memory.id, { type, title, content, tags })
      setEditing(false)
      router.refresh()
    })
  }

  const handleArchive = () => {
    if (!confirm('Archive this memory? It will be hidden from the default list but can be restored later.')) return
    startTransition(async () => {
      await archiveMemoryAction(scope, projectId, memory.id)
      router.refresh()
    })
  }

  const handleRestore = () => {
    startTransition(async () => {
      await restoreMemoryAction(scope, projectId, memory.id)
      router.refresh()
    })
  }

  const handleDelete = () => {
    if (!confirm('Permanently delete this memory? This cannot be undone.')) return
    startTransition(async () => {
      await removeMemoryAction(scope, projectId, memory.id)
    })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-8">
      <article className="min-w-0">
        <header className="mb-6 pb-5" style={{ borderBottom: '1.5px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            {editing ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                className="text-2xl font-bold tracking-tight bg-transparent outline-none border-b flex-1 min-w-[200px]"
                style={{ color: 'var(--text)', borderColor: 'var(--border)' }}
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                {memory.title ?? memory.id}
              </h1>
            )}

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowRaw((value) => !value)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono"
                style={{
                  border: `1.5px solid ${showRaw ? 'var(--accent)' : 'var(--border)'}`,
                  color: showRaw ? 'var(--accent)' : 'var(--muted)',
                }}
                title="View the full stored record as JSON, regardless of how content renders"
              >
                <Braces size={12} /> RAW
              </button>
              {editing ? (
                <>
                  <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono font-semibold"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    <Save size={12} /> SAVE
                  </button>
                  <button
                    onClick={() => {
                      setEditing(false)
                      setType(memory.type)
                      setTitle(memory.title ?? '')
                      setContent(memory.content)
                      setTagsInput(memory.tags.join(', '))
                    }}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono"
                    style={{ border: '1.5px solid var(--border)', color: 'var(--muted)' }}
                  >
                    <X size={12} /> CANCEL
                  </button>
                </>
              ) : (
                <>
                  {canEdit && (
                    <button
                      onClick={() => setEditing(true)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono font-semibold"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      <Edit size={12} /> EDIT
                    </button>
                  )}
                  {canRestore && (
                    <button
                      onClick={handleRestore}
                      disabled={isPending}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono"
                      style={{ border: '1.5px solid var(--border)', color: 'var(--text)' }}
                    >
                      <ArchiveRestore size={12} /> RESTORE
                    </button>
                  )}
                  {canArchive && (
                    <button
                      onClick={handleArchive}
                      disabled={isPending}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono"
                      style={{ border: '1.5px solid var(--border)', color: 'var(--muted)' }}
                    >
                      <Archive size={12} /> ARCHIVE
                    </button>
                  )}
                  <button
                    onClick={handleDelete}
                    disabled={isPending}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono"
                    style={{ border: '1.5px solid #c0392b', color: '#c0392b' }}
                  >
                    <Trash2 size={12} /> DELETE
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap text-xs font-mono">
            {editing ? (
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="px-1.5 py-0.5 rounded border bg-transparent"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            ) : (
              <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                {memory.type}
              </span>
            )}
            <span style={{ color: 'var(--muted)' }}>{memory.status}</span>
            <span style={{ color: 'var(--muted)' }}>· updated {memory.updatedAt}</span>
          </div>

          {editing ? (
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="tags, comma, separated"
              className="mt-2 w-full text-xs bg-transparent outline-none border-b py-1"
              style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            />
          ) : (
            memory.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {memory.tags.map((tag) => (
                  <span key={tag} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )
          )}
        </header>

        {showRaw ? (
          <pre
            className="w-full text-xs font-mono p-3 rounded overflow-x-auto whitespace-pre-wrap break-words"
            style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
          >
            {JSON.stringify(memory, null, 2)}
          </pre>
        ) : editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full text-sm font-mono p-3 rounded outline-none"
            style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
          />
        ) : (
          <MarkdownRenderer content={memory.content} />
        )}
      </article>

      <aside className="hidden lg:block">
        <div className="sticky top-8">
          <TableOfContents headings={headings} />
        </div>
      </aside>
    </div>
  )
}
