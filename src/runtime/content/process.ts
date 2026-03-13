import type { ImageSize, ParsedContent } from '../../types'
import { buildQuery, buildStyle, isValidAsset, list, parseQuery, removeQuery, walkBody, walkMeta } from '../utils'

/**
 * Walk the parsed frontmatter and check properties as paths
 *
 * Works with both Content v2 and v3 content objects (the content
 * should have _file and _id set for asset resolution)
 */
export function processMeta (
  content: ParsedContent,
  imageSizes: ImageSize = [],
  assets: { resolveAsset: (content: ParsedContent, relAsset: string, registerContent?: boolean) => any },
  debug = false,
  updated: string[] = [],
) {
  walkMeta(content, (value: string | number, parent: Record<string, any>, key: string) => {
    if (isValidAsset(value)) {
      const { srcAttr, width, height } = assets.resolveAsset(content, removeQuery(value), true)
      if (srcAttr) {
        const query = width && height && (imageSizes.includes('src') || imageSizes.includes('url'))
          ? `width=${width}&height=${height}`
          : ''
        const srcUrl = query
          ? buildQuery(srcAttr, parseQuery(value), query)
          : srcAttr
        parent[key] = srcUrl
        updated.push(`meta: ${key} to "${srcUrl}"`)
      }
    }
  })
}

/**
 * Walk the parsed content body and check potential attributes as paths
 *
 * Works with both Content v2 (hast/MDC AST) and v3 (minimark) body formats
 */
export function processBody (
  content: ParsedContent,
  imageSizes: ImageSize = [],
  assets: { resolveAsset: (content: ParsedContent, relAsset: string, registerContent?: boolean) => any },
  debug = false,
  updated: string[] = [],
) {
  walkBody(content, function (node: any) {
    const { tag, props } = node
    for (const [prop, value] of Object.entries(props)) {
      // only process strings
      if (typeof value !== 'string') {
        continue
      }

      // parse value
      const { srcAttr, width, height } = assets.resolveAsset(content, value, true)

      // if we resolved an asset
      if (srcAttr) {
        // assign src
        props[prop] = srcAttr

        // assign size
        if (tag === 'img' || tag === 'nuxt-img') {
          if (width && height) {
            if (imageSizes.includes('attrs')) {
              props.width = width
              props.height = height
            }
            if (imageSizes.includes('style')) {
              const ratio = `${width}/${height}`
              if (typeof props.style === 'string') {
                props.style = buildStyle(props.style, `aspect-ratio: ${ratio}`)
              }
              else {
                props.style ||= {}
                props.style.aspectRatio = ratio
              }
            }
          }
        }

        // open links in new window
        else if (tag === 'a') {
          props.target ||= '_blank'
        }

        // debug
        updated.push(`page: ${tag}[${prop}] to "${srcAttr}"`)
      }
    }
  })
}
