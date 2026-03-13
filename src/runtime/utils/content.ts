import { CONTINUE, SKIP, visit } from 'unist-util-visit'
import type { ParsedContent } from '../../types'
import { type WalkCallback, walk } from './object'
import { matchTokens } from './string'

/**
 * Walk parsed content meta, only processing relevant properties
 *
 * Skips internal properties (starting with '_' for Content v2, known system keys for v3)
 * and the 'body' property which is processed separately
 *
 * @param content
 * @param callback
 */
export function walkMeta (content: ParsedContent, callback: WalkCallback) {
  walk(content, callback, (value, key) => {
    const k = String(key)
    // Skip Content v2 internal properties (start with '_')
    if (k.startsWith('_')) return false
    // Skip body (processed separately) and Content v3 system properties
    if (systemKeys.has(k)) return false
    return true
  })
}

/** System keys to skip when walking metadata (these are framework-internal properties, not user content) */
const systemKeys = new Set([
  // Shared: processed separately
  'body',
  // Content v3 system properties
  'id', 'path', 'stem', 'extension', '__metadata', 'meta', 'seo', 'rawbody',
])

/**
 * Walk parsed content body, only visiting relevant tags
 *
 * Supports both Content v2 (hast/MDC AST) and Content v3 (minimark) body formats
 *
 * @param content
 * @param callback
 */
export function walkBody (content: ParsedContent, callback: (node: any) => void) {
  if (!content.body) {
    return
  }

  // Content v3: minimark format { type: 'minimark', value: [...] }
  if (content.body.type === 'minimark' && Array.isArray(content.body.value)) {
    walkMinimark(content.body.value, callback)
    return
  }

  // Content v2: hast/MDC AST format { type: 'root', children: [...] }
  if (content.body.children) {
    visit(content.body, (node: any) => node.type === 'element', (node) => {
      // variables
      const { tag, props } = node

      // skip containers we think won't contain assets
      const excluded = tags.exclude.includes(tag)
      if (excluded) {
        return SKIP
      }

      // traverse containers we think could contain assets
      const included = tags.include.includes(tag)
      if (included || !props) {
        return CONTINUE
      }

      // process node
      callback(node)
    })
  }
}

/**
 * Walk a minimark tree (Content v3 format)
 *
 * Minimark nodes are either:
 * - strings (text nodes)
 * - arrays: [tag, props, ...children]
 *
 * @param nodes   Array of minimark nodes
 * @param callback  Called with a normalized node object { tag, props } for element nodes
 */
function walkMinimark (nodes: any[], callback: (node: any) => void) {
  for (const node of nodes) {
    if (!Array.isArray(node)) {
      continue // skip text nodes (strings)
    }

    const [tag, props, ...children] = node

    // skip containers we think won't contain assets
    if (tags.exclude.includes(tag)) {
      continue
    }

    // traverse containers we think could contain assets
    if (tags.include.includes(tag) || !props) {
      walkMinimark(children, callback)
      continue
    }

    // process node - wrap in an object compatible with Content v2 format
    // so the same callback can handle both formats
    callback({ tag, props })

    // also walk children of asset-bearing nodes
    if (children.length > 0) {
      walkMinimark(children, callback)
    }
  }
}

const tags = {
  // unlikely to contain assets
  exclude: matchTokens({
    container: 'pre code code-inline',
    formatting: 'acronym abbr address bdi bdo big center cite del dfn font ins kbd mark meter progress q rp rt ruby s samp small strike sub sup time tt u var wbr',
    headers: 'h1 h2 h3 h4 h5 h6',
    controls: 'input textarea button select optgroup option label legend datalist output',
    media: 'map area canvas svg',
    other: 'style script noscript template',
    empty: 'hr br',
  }),

  // may contain assets
  include: matchTokens({
    content: 'main header footer section article aside details dialog summary data object nav blockquote div span p',
    table: 'table caption th tr td thead tbody tfoot col colgroup',
    media: 'figcaption figure picture',
    form: 'form fieldset',
    list: 'ul ol li dir dl dt dd',
    formatting: 'strong b em i',
  }),

  // assets
  assets: 'a img audio source track video embed',
}
