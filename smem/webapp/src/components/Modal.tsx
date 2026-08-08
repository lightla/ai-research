'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: 'md' | 'lg'
}

export default function Modal({ title, onClose, children, width = 'md' }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${width === 'lg' ? 'max-w-3xl' : 'max-w-lg'} max-h-[85vh] overflow-y-auto rounded-lg`}
        style={{ background: 'var(--bg)', border: '1.5px solid var(--border)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 sticky top-0"
          style={{ background: 'var(--bg)', borderBottom: '1.5px solid var(--border)' }}
        >
          <h2 className="text-sm font-bold font-mono" style={{ color: 'var(--text)' }}>{title}</h2>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
