import { Marked } from 'marked'

// Raw history content is sometimes a tool/diff dump (unified diff hunks, `[diff_block_start]`
// markers) rather than prose. Fed straight into a markdown renderer, lines starting with `+`/`-`
// or wrapped in `_x_`/`*x*` get misread as list items or emphasis. Wrap anything diff-shaped in a
// fenced code block first so it renders verbatim instead of getting mangled.
export function wrapIfCodeLike(content: string): string {
  const looksLikeDiff =
    /^@@\s*-\d+(,\d+)?\s*\+\d+(,\d+)?\s*@@/m.test(content) || content.includes('[diff_block_start]')
  if (!looksLikeDiff) {
    return content
  }
  const escaped = content.replace(/```/g, '​```')
  return `\`\`\`\n${escaped}\n\`\`\``
}

export interface TocItem {
  id: string
  text: string
  level: number
  children: TocItem[]
}

export function slugifyHeading(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function extractHeadings(markdown: string): TocItem[] {
  const flat: { id: string; text: string; level: number }[] = []

  // Strip code blocks to avoid counting comment headers inside code blocks
  const cleanMarkdown = (markdown || '')
    .replace(/```[\s\S]*?```/g, '')

  const parser = new Marked()
  parser.use({
    renderer: {
      heading(this: any, arg: any, secondArg?: any) {
        let text = ''
        let level = 1
        if (typeof arg === 'object' && arg !== null) {
          text = arg.text || ''
          level = arg.depth || 1
        } else if (typeof arg === 'string') {
          text = arg
          level = typeof secondArg === 'number' ? secondArg : 1
        }

        // Strip HTML tags from heading text
        const cleanText = text.replace(/<[^>]*>/g, '').trim()
        const id = slugifyHeading(cleanText)
        flat.push({ id, text: cleanText, level })
        return `<h${level} id="${id}">${text}</h${level}>`
      }
    }
  })

  parser.parse(cleanMarkdown)

  const root: TocItem[] = []
  const stack: TocItem[] = []
  for (const item of flat) {
    const node: TocItem = { ...item, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop()
    }
    if (stack.length === 0) {
      root.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }
    stack.push(node)
  }
  return root
}

export function flattenToc(nodes: TocItem[], result: { id: string; text: string; level: number }[] = []) {
  for (const n of nodes) {
    result.push({ id: n.id, text: n.text, level: n.level })
    flattenToc(n.children, result)
  }
  return result
}
