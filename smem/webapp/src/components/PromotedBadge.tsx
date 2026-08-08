'use client'

import { useState } from 'react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import Modal from './Modal'
import MarkdownRenderer from './MarkdownRenderer'
import type { PromotedInfo, Scope } from '@/lib/smem'

interface Props {
  info: PromotedInfo
  scope: Scope
  projectId: string | null
}

// Shown on a raw history card once its content (alone or merged with others) has been saved as
// an official memory — the raw item itself is never deleted or hidden, this is purely a "this
// already became memory mem_xxx" pointer so the user doesn't re-save the same thing twice.
export default function PromotedBadge({ info, scope, projectId }: Props) {
  const [open, setOpen] = useState(false)
  const detailHref = scope === 'global' ? `/global/${info.memoryId}` : `/p/${projectId}/${info.memoryId}`

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded"
        style={{ background: 'var(--bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
        title="Đã lưu thành official memory — bấm để xem"
      >
        <CheckCircle2 size={10} /> đã lưu
      </button>

      {open && (
        <Modal title="Đã lưu thành official memory" onClose={() => setOpen(false)}>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
            >
              {info.type}
            </span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>{info.memoryId}</span>
          </div>
          {info.title && (
            <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text)' }}>{info.title}</div>
          )}
          <div className="text-xs max-h-64 overflow-y-auto mb-4 pr-1">
            <MarkdownRenderer content={info.content} />
          </div>
          <a
            href={detailHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-mono font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <ExternalLink size={12} /> Xem chi tiết (tab mới)
          </a>
        </Modal>
      )}
    </>
  )
}
