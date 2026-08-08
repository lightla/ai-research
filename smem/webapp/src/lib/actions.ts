'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  archiveMemory,
  createMemory,
  deleteHistoryMatch,
  findPromotedRawIds,
  getProject,
  removeMemory,
  restoreMemory,
  searchHistory,
  updateHistoryContent,
  updateMemory,
  type HistoryMatch,
  type MergedFromEntry,
  type PromotedInfo,
  type Scope,
} from './smem'

function listPath(scope: Scope, projectId: string | null): string {
  return scope === 'global' ? '/global' : `/p/${projectId}`
}

function detailPath(scope: Scope, projectId: string | null, id: string): string {
  return scope === 'global' ? `/global/${id}` : `/p/${projectId}/${id}`
}

export async function saveMemoryAction(
  scope: Scope,
  projectId: string | null,
  id: string,
  input: { type: string; namespace?: string | null; title: string; content: string; tags: string[] }
) {
  updateMemory(scope, projectId, id, {
    type: input.type as any,
    namespace: input.namespace ?? null,
    title: input.title.trim().length > 0 ? input.title.trim() : null,
    content: input.content,
    tags: input.tags,
  })
  revalidatePath(listPath(scope, projectId))
  revalidatePath(detailPath(scope, projectId, id))
}

export async function archiveMemoryAction(scope: Scope, projectId: string | null, id: string) {
  archiveMemory(scope, projectId, id)
  revalidatePath(listPath(scope, projectId))
  revalidatePath(detailPath(scope, projectId, id))
}

export async function restoreMemoryAction(scope: Scope, projectId: string | null, id: string) {
  restoreMemory(scope, projectId, id)
  revalidatePath(listPath(scope, projectId))
  revalidatePath(detailPath(scope, projectId, id))
}

export async function removeMemoryAction(scope: Scope, projectId: string | null, id: string) {
  removeMemory(scope, projectId, id)
  revalidatePath(listPath(scope, projectId))
  redirect(listPath(scope, projectId))
}

export async function searchHistoryAction(
  query: string,
  scope: Scope,
  projectId: string | null,
  offset = 0,
  filters: { agent?: string; kind?: string } = {}
): Promise<HistoryMatch[]> {
  const projectPath = scope === 'local' && projectId ? getProject(projectId)?.rootPath : undefined
  return searchHistory(query, { projectPath, offset, ...filters })
}

export async function deleteHistoryAction(kind: 'event' | 'transcript', id: string): Promise<boolean> {
  return deleteHistoryMatch(kind, id)
}

export async function updateHistoryAction(
  id: string,
  content: string,
  extra?: { type?: string; namespace?: string | null; title?: string | null; tags?: string[] }
): Promise<HistoryMatch | null> {
  return updateHistoryContent(id, content, extra)
}

export async function promoteHistoryAction(
  scope: Scope,
  projectId: string | null,
  input: { type: string; namespace?: string | null; title: string; content: string; tags: string[] },
  source?: MergedFromEntry
) {
  const memory = createMemory(
    scope,
    projectId,
    {
      type: input.type as any,
      namespace: input.namespace ?? null,
      ...(input.title.trim() ? { title: input.title.trim() } : {}),
      content: input.content,
      tags: input.tags,
      status: 'active',
    },
    { sourceKind: 'history-promote', ...(source ? { source: { mergedFrom: [source] } } : {}) }
  )
  revalidatePath(listPath(scope, projectId))
  return memory
}

/**
 * Same as `promoteHistoryAction` but from N selected raw history items merged into one record —
 * the "a fact often spans several messages" case. Raw items never disappear; `source.mergedFrom`
 * is what `findPromotedRawIdsAction` uses to badge them as already saved afterward.
 */
export async function mergeHistoryAction(
  scope: Scope,
  projectId: string | null,
  sources: MergedFromEntry[],
  input: { type: string; namespace?: string | null; title: string; content: string; tags: string[] }
) {
  const memory = createMemory(
    scope,
    projectId,
    {
      type: input.type as any,
      namespace: input.namespace ?? null,
      ...(input.title.trim() ? { title: input.title.trim() } : {}),
      content: input.content,
      tags: input.tags,
      status: 'active',
    },
    { sourceKind: 'history-merge', source: { mergedFrom: sources } }
  )
  revalidatePath(listPath(scope, projectId))
  return memory
}

export async function findPromotedRawIdsAction(
  scope: Scope,
  projectId: string | null,
  rawIds: string[]
): Promise<Record<string, PromotedInfo>> {
  if (rawIds.length === 0) return {}
  return findPromotedRawIds(scope, projectId, rawIds)
}
