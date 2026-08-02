'use client'

import { useState, useRef, useEffect, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/base16/github.css'
import 'katex/dist/katex.min.css'
import { slugifyHeading } from '@/lib/markdown'
import { Copy, Check, ExternalLink } from 'lucide-react'

// remark-math/rehype-katex (and the katex CSS) are only needed for content that actually contains
// math syntax. Load lazily once per page load so every memory doesn't pay for katex on hydration.
let mathPluginsPromise: Promise<{ remarkMath: any; rehypeKatex: any }> | null = null
function loadMathPlugins() {
  if (!mathPluginsPromise) {
    mathPluginsPromise = Promise.all([
      import('remark-math'),
      import('rehype-katex'),
    ]).then(([remarkMathMod, rehypeKatexMod]) => ({
      remarkMath: remarkMathMod.default,
      rehypeKatex: rehypeKatexMod.default,
    }))
  }
  return mathPluginsPromise
}

function getChildrenText(children: any): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(getChildrenText).join('')
  if (children && typeof children === 'object') {
    if (children.props && children.props.children) {
      return getChildrenText(children.props.children)
    }
  }
  return ''
}

function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  const handleCopy = () => {
    const text = preRef.current?.innerText ?? ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ position: 'relative' }}>
      <pre ref={preRef} {...props} style={{ background: '#f3f2ee' }}>{children}</pre>
      <button
        onClick={handleCopy}
        title="Copy code"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          padding: '3px 6px',
          background: copied ? '#d4edda' : 'rgba(0,0,0,0.10)',
          border: `1px solid ${copied ? '#4a8a4a' : 'rgba(0,0,0,0.28)'}`,
          borderRadius: 4,
          color: copied ? '#2d6a35' : 'rgba(0,0,0,0.65)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          fontFamily: 'ui-monospace, monospace',
          transition: 'all 0.15s',
          zIndex: 2,
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

interface Props {
  content: string
}

const MarkdownRenderer = memo(function MarkdownRenderer({ content }: Props) {
  const [mathPlugins, setMathPlugins] = useState<{ remarkMath: any; rehypeKatex: any } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadMathPlugins().then(plugins => {
      if (!cancelled) setMathPlugins(plugins)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className="prose max-w-none [&_code::before]:content-none [&_code::after]:content-none"
      style={{
        '--tw-prose-body': 'var(--text)',
        '--tw-prose-headings': 'var(--text)',
        '--tw-prose-links': 'var(--accent)',
        '--tw-prose-hr': 'var(--border)',
      } as React.CSSProperties}
    >
      <ReactMarkdown
        remarkPlugins={mathPlugins ? [remarkGfm, mathPlugins.remarkMath] : [remarkGfm]}
        rehypePlugins={mathPlugins ? [rehypeHighlight, mathPlugins.rehypeKatex] : [rehypeHighlight]}
        components={{
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>

            if (href.startsWith('#')) {
              return (
                <a href={href} style={{ color: 'var(--accent)' }} className="hover:underline">
                  {children}
                </a>
              )
            }

            return (
              <a
                href={href}
                className="inline-flex items-center gap-0.5 hover:underline"
                style={{ color: 'var(--accent)' }}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{children}</span>
                <ExternalLink size={11} className="ml-0.5" style={{ opacity: 0.6 }} />
              </a>
            )
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse text-sm" style={{ borderColor: 'var(--border)' }}>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2 text-left font-semibold border" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2 border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="pl-4 my-4" style={{ borderLeft: '3px solid var(--accent)', color: 'var(--muted)' }}>
              {children}
            </blockquote>
          ),
          h1: ({ children }) => { const id = slugifyHeading(getChildrenText(children)); return <h1 id={id} className="text-2xl font-bold mt-8 mb-4 scroll-mt-20" style={{ color: 'var(--text)' }}>{children}</h1> },
          h2: ({ children }) => { const id = slugifyHeading(getChildrenText(children)); return <h2 id={id} className="text-xl font-semibold mt-7 mb-3 pb-2 border-b scroll-mt-20" style={{ color: 'var(--text)', borderColor: 'var(--border)' }}>{children}</h2> },
          h3: ({ children }) => { const id = slugifyHeading(getChildrenText(children)); return <h3 id={id} className="text-lg font-semibold mt-5 mb-2 scroll-mt-20" style={{ color: 'var(--text)' }}>{children}</h3> },
          h4: ({ children }) => { const id = slugifyHeading(getChildrenText(children)); return <h4 id={id} className="text-base font-semibold mt-4 mb-1.5 scroll-mt-20" style={{ color: 'var(--text)' }}>{children}</h4> },
          h5: ({ children }) => { const id = slugifyHeading(getChildrenText(children)); return <h5 id={id} className="text-sm font-semibold mt-3 mb-1 scroll-mt-20" style={{ color: 'var(--text)' }}>{children}</h5> },
          h6: ({ children }) => { const id = slugifyHeading(getChildrenText(children)); return <h6 id={id} className="text-xs font-semibold mt-3 mb-1 uppercase tracking-wider scroll-mt-20" style={{ color: 'var(--muted)' }}>{children}</h6> },
          pre: ({ children, ...props }) => <CodeBlock {...props}>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes('hljs') || className?.includes('language-')
            if (isBlock) {
              return <code className={className} style={{ background: '#f3f2ee' }} {...props}>{children}</code>
            }
            return (
              <code
                className="px-1 py-0.5 rounded text-[0.9em] font-mono"
                style={{ background: '#f3f2ee', color: '#c7254e' }}
                {...props}
              >{children}</code>
            )
          },
          hr: () => <hr className="my-6" style={{ borderColor: 'var(--border)' }} />,
          ul: ({ children, className }) => {
            const isTaskList = className?.includes('contains-task-list')
            return (
              <ul className={`my-1.5 ${className ?? ''} ${isTaskList ? 'list-none' : 'list-disc pl-4'}`} style={{ color: 'var(--text)' }}>{children}</ul>
            )
          },
          ol: ({ children }) => <ol className="my-1.5 pl-4 list-decimal" style={{ color: 'var(--text)' }}>{children}</ol>,
          li: ({ children, className }) => (
            <li className={className ?? ''} style={{
              color: 'var(--text)',
              ...(className?.includes('task-list-item') ? {
                display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
                gap: '0 5px', listStyle: 'none',
              } : {})
            }}>{children}</li>
          ),
          input: ({ type, checked }) => type === 'checkbox' ? (
            <input type="checkbox" checked={checked ?? false} readOnly
              style={{ width: 13, height: 13, marginTop: 3, flexShrink: 0, accentColor: 'var(--text)', cursor: 'default' }} />
          ) : null,
          p: ({ children }) => <p className="my-3 leading-relaxed" style={{ color: 'var(--text)' }}>{children}</p>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownRenderer
