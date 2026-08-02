import Link from 'next/link'
import { Globe, FolderGit2 } from 'lucide-react'
import { listProjects } from '@/lib/smem'

export const dynamic = 'force-dynamic'

export default function HomePage() {
  const projects = listProjects()

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text)' }}>Smart Memory Manager</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>
        Browse, search, edit, archive, or delete Smart Memory records.
      </p>

      <Link
        href="/global"
        className="flex items-center gap-3 px-4 py-3 rounded-lg mb-6 hover:brightness-[0.98]"
        style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}
      >
        <Globe size={16} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-medium">Global memories</span>
      </Link>

      <h2 className="text-xs font-mono uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Projects</h2>
      {projects.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No projects attached yet. Run <code>smem init</code> in a project directory.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.projectId}>
              <Link
                href={`/p/${project.projectId}`}
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:brightness-[0.98]"
                style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}
              >
                <FolderGit2 size={16} style={{ color: 'var(--muted)' }} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{project.projectName}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>{project.rootPath}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
