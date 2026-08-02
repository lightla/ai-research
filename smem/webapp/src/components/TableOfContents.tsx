'use client'

import { useEffect, useRef, useState } from 'react'
import type { TocItem } from '@/lib/markdown'

interface Props {
  headings: TocItem[]
}

// Button row height (font 13 * lineHeight 1.6 + padding 2+2)
const ROW_MID = 12  // horizontal connector y = button midpoint

function collectIds(items: TocItem[]): string[] {
  const ids: string[] = []
  for (const item of items) {
    ids.push(item.id)
    ids.push(...collectIds(item.children))
  }
  return ids
}

function TocNode({
  item,
  activeId,
  onScrollTo,
  isLast = false,
}: {
  item: TocItem
  activeId: string
  onScrollTo: (id: string) => void
  isLast?: boolean
}) {
  const isActive = activeId === item.id
  const [hovered, setHovered] = useState(false)

  return (
    <li style={{ position: 'relative', paddingLeft: 15 }}>
      <span style={{
        position: 'absolute',
        left: 0,
        top: 0,
        ...(isLast ? { height: ROW_MID } : { bottom: 0 }),
        width: 0,
        borderLeft: '1px solid var(--border)',
        display: 'block',
        pointerEvents: 'none',
        zIndex: 0,
      }} />
      <span style={{
        position: 'absolute',
        left: 0,
        top: ROW_MID,
        width: 13,
        height: 0,
        borderTop: '1px solid var(--border)',
        display: 'block',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      <button
        onClick={() => onScrollTo(item.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={item.text}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          padding: '2px 6px 2px 0',
          fontSize: 13,
          lineHeight: 1.6,
          color: isActive ? '#3d47c4' : 'var(--muted)',
          fontWeight: isActive ? 600 : 400,
          background: isActive ? '#eceef8' : hovered ? 'rgba(108,114,232,0.07)' : 'transparent',
          borderRadius: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          position: 'relative',
          zIndex: 1,
          transition: 'background 0.1s',
        }}
      >
        {item.text}
      </button>

      {item.children.length > 0 && (
        <ul style={{ listStyle: 'none', padding: '0 0 0 13px', margin: 0 }}>
          {item.children.map((child, i) => (
            <TocNode
              key={child.id}
              item={child}
              activeId={activeId}
              onScrollTo={onScrollTo}
              isLast={i === item.children.length - 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function TableOfContents({ headings }: Props) {
  const [activeId, setActiveId] = useState<string>('')
  const clickLock = useRef(false)
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const ids = collectIds(headings)
    if (ids.length === 0) return
    const observer = new IntersectionObserver(
      entries => {
        if (clickLock.current) return
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )
    ids.forEach(id => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  const scrollTo = (id: string) => {
    setActiveId(id)
    clickLock.current = true
    if (lockTimer.current) clearTimeout(lockTimer.current)
    lockTimer.current = setTimeout(() => { clickLock.current = false }, 1200)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      <ul className="toc-tree">
        {headings.map((h, i) => (
          <TocNode
            key={h.id}
            item={h}
            activeId={activeId}
            onScrollTo={scrollTo}
            isLast={i === headings.length - 1}
          />
        ))}
      </ul>
    </div>
  )
}
