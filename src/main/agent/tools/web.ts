import { clip, type Tool } from './types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36 GenieXStudio/0.1'

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

/** Very small HTML → readable text conversion (no DOM): drops scripts/styles/nav, keeps headings, paragraphs, lists, links. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, '')
  // Keep main/article if present
  const main = s.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)
  if (main && main[2].length > 500) s = main[2]
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|li|tr|h[1-6]|blockquote|pre|table)>/gi, '\n')
    .replace(/<(h1)[^>]*>/gi, '\n# ')
    .replace(/<(h2)[^>]*>/gi, '\n## ')
    .replace(/<(h3|h4|h5|h6)[^>]*>/gi, '\n### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const t = inner.replace(/<[^>]+>/g, '').trim()
      return t && /^https?:/i.test(href) ? `${t} (${href})` : t
    })
    .replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
  return { title: title ? decodeEntities(title) : null, text: s }
}

export const webSearchTool: Tool = {
  name: 'web_search',
  family: 'web',
  risk: 'network',
  description: 'Search the web (DuckDuckGo) and return the top results with titles, URLs and snippets. Follow up with web_fetch to read a page.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      max_results: { type: 'integer', description: 'Default 8, max 15' },
    },
    required: ['query'],
  },
  summarize: (a) => `Search: ${String(a.query ?? '')}`,
  needsApproval: () => false,
  async run(a, rc) {
    const query = String(a.query ?? '').trim()
    if (!query) return { ok: false, content: 'query is empty.' }
    const max = Math.max(1, Math.min(15, Number(a.max_results ?? 8)))
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.any([rc.signal, AbortSignal.timeout(20_000)]) })
    if (!res.ok) return { ok: false, content: `Search failed: HTTP ${res.status}` }
    const html = await res.text()
    const results: { title: string; url: string; snippet: string }[] = []
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) && results.length < max) {
      let href = decodeEntities(m[1])
      const uddg = href.match(/[?&]uddg=([^&]+)/)
      if (uddg) href = decodeURIComponent(uddg[1])
      if (!/^https?:/i.test(href)) continue
      const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim()
      const snippet = decodeEntities((m[3] ?? m[4] ?? '').replace(/<[^>]+>/g, '')).trim()
      if (title) results.push({ title, url: href, snippet })
    }
    if (!results.length) return { ok: true, content: 'No results (or the search page format changed).', meta: { results: [] } }
    const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n')
    return { ok: true, content: clip(text), meta: { results } }
  },
}

export const webFetchTool: Tool = {
  name: 'web_fetch',
  family: 'web',
  risk: 'network',
  description: 'Fetch a web page (http/https) and return its readable text content (scripts/nav stripped). Max ~12k characters.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      max_chars: { type: 'integer', description: 'Default 12000' },
    },
    required: ['url'],
  },
  summarize: (a) => `Fetch ${String(a.url ?? '')}`,
  needsApproval: () => false,
  async run(a, rc) {
    const url = String(a.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return { ok: false, content: 'Only http(s) URLs are allowed.' }
    const host = new URL(url).hostname
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/.test(host)) return { ok: false, content: 'Refusing to fetch local/private addresses.' }
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.any([rc.signal, AbortSignal.timeout(30_000)]) })
    const ctype = res.headers.get('content-type') ?? ''
    if (!res.ok) return { ok: false, content: `HTTP ${res.status} ${res.statusText}` }
    const max = Math.max(500, Math.min(60_000, Number(a.max_chars ?? 12_000)))
    const raw = await res.text()
    if (/json/i.test(ctype)) return { ok: true, content: clip(raw, max), meta: { url: res.url, contentType: ctype } }
    if (/text\/plain|markdown/i.test(ctype)) return { ok: true, content: clip(raw, max), meta: { url: res.url, contentType: ctype } }
    const { title, text } = htmlToText(raw)
    return { ok: true, content: clip(`${title ? `# ${title}\n\n` : ''}${text}`, max), meta: { url: res.url, title, contentType: ctype } }
  },
}

export const webTools: Tool[] = [webSearchTool, webFetchTool]
