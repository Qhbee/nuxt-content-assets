import { describe, expect, it } from 'vitest'
import { walkBody, walkMeta } from '../../src/runtime/utils/content'
import type { ParsedContent } from '../../src/types'

/**
 * Tests for Content v3 minimark body walking
 */
describe('walkBody - minimark format (Content v3)', () => {
  it('should walk minimark elements and find img tags', () => {
    const content: ParsedContent = {
      _id: 'test',
      _source: '',
      _dir: '',
      _path: '',
      _file: 'test.md',
      _type: 'markdown',
      _extension: 'md',
      body: {
        type: 'minimark',
        value: [
          ['p', {}, 'Hello ', ['img', { src: './image.png', alt: 'test' }]],
          ['p', {}, 'World'],
        ],
      },
    }

    const visited: Array<{ tag: string; props: any }> = []
    walkBody(content, (node: any) => {
      visited.push({ tag: node.tag, props: { ...node.props } })
    })

    expect(visited).toHaveLength(1)
    expect(visited[0].tag).toBe('img')
    expect(visited[0].props.src).toBe('./image.png')
  })

  it('should walk nested minimark elements', () => {
    const content: ParsedContent = {
      _id: 'test',
      _source: '',
      _dir: '',
      _path: '',
      _file: 'test.md',
      _type: 'markdown',
      _extension: 'md',
      body: {
        type: 'minimark',
        value: [
          ['div', {},
            ['a', { href: './doc.pdf' }, 'Download'],
            ['img', { src: './photo.jpg', alt: 'photo' }],
          ],
        ],
      },
    }

    const visited: Array<{ tag: string; props: any }> = []
    walkBody(content, (node: any) => {
      visited.push({ tag: node.tag, props: { ...node.props } })
    })

    expect(visited).toHaveLength(2)
    expect(visited[0].tag).toBe('a')
    expect(visited[0].props.href).toBe('./doc.pdf')
    expect(visited[1].tag).toBe('img')
    expect(visited[1].props.src).toBe('./photo.jpg')
  })

  it('should skip excluded tags in minimark format', () => {
    const content: ParsedContent = {
      _id: 'test',
      _source: '',
      _dir: '',
      _path: '',
      _file: 'test.md',
      _type: 'markdown',
      _extension: 'md',
      body: {
        type: 'minimark',
        value: [
          ['pre', {},
            ['code', {}, 'const x = 1'],
          ],
          ['img', { src: './visible.png', alt: 'visible' }],
        ],
      },
    }

    const visited: Array<{ tag: string }> = []
    walkBody(content, (node: any) => {
      visited.push({ tag: node.tag })
    })

    // pre and code should be excluded, only img should be visited
    expect(visited).toHaveLength(1)
    expect(visited[0].tag).toBe('img')
  })

  it('should allow modifying props in minimark format (in-place mutation)', () => {
    const body = {
      type: 'minimark',
      value: [
        ['p', {}, ['img', { src: './old.png', alt: 'test' }]],
      ],
    }
    const content: ParsedContent = {
      _id: 'test',
      _source: '',
      _dir: '',
      _path: '',
      _file: 'test.md',
      _type: 'markdown',
      _extension: 'md',
      body,
    }

    walkBody(content, (node: any) => {
      if (node.tag === 'img') {
        node.props.src = '/absolute/new.png'
        node.props.width = 100
        node.props.height = 200
      }
    })

    // Verify the original minimark array was modified in-place
    // minimark format: body.value[0] = ['p', {}, ['img', {...}]]
    //                                   ^tag ^props ^child(index 2)
    const imgNode = (body.value[0] as any[])[2] // the child img element: ['img', { src: ... }]
    expect(imgNode[1].src).toBe('/absolute/new.png')
    expect(imgNode[1].width).toBe(100)
    expect(imgNode[1].height).toBe(200)
  })

  it('should handle empty body gracefully', () => {
    const content: ParsedContent = {
      _id: 'test',
      _source: '',
      _dir: '',
      _path: '',
      _file: 'test.md',
      _type: 'markdown',
      _extension: 'md',
      body: null as any,
    }

    const visited: any[] = []
    walkBody(content, (node: any) => {
      visited.push(node)
    })
    expect(visited).toHaveLength(0)
  })

  it('should walk deprecated "minimal" body type (legacy minimark format)', () => {
    const content: ParsedContent = {
      _id: 'test',
      _source: '',
      _dir: '',
      _path: '',
      _file: 'test.md',
      _type: 'markdown',
      _extension: 'md',
      body: {
        type: 'minimal',
        value: [
          ['p', {}, 'Hello ', ['img', { src: './legacy.png', alt: 'legacy' }]],
        ],
      },
    }

    const visited: Array<{ tag: string; props: any }> = []
    walkBody(content, (node: any) => {
      visited.push({ tag: node.tag, props: { ...node.props } })
    })

    expect(visited).toHaveLength(1)
    expect(visited[0].tag).toBe('img')
    expect(visited[0].props.src).toBe('./legacy.png')
  })
})

/**
 * Tests for Content v2 hast/MDC body walking (backward compatibility)
 */
describe('walkBody - hast format (Content v2)', () => {
  it('should walk hast elements and find img tags', () => {
    const content: ParsedContent = {
      _id: 'test',
      _source: '',
      _dir: '',
      _path: '',
      _file: 'test.md',
      _type: 'markdown',
      _extension: 'md',
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'p',
            props: {},
            children: [
              { type: 'text', value: 'Hello ' },
              { type: 'element', tag: 'img', props: { src: './image.png', alt: 'test' }, children: [] },
            ],
          },
        ],
      },
    }

    const visited: Array<{ tag: string; props: any }> = []
    walkBody(content, (node: any) => {
      visited.push({ tag: node.tag, props: { ...node.props } })
    })

    expect(visited).toHaveLength(1)
    expect(visited[0].tag).toBe('img')
    expect(visited[0].props.src).toBe('./image.png')
  })
})

/**
 * Tests for walkMeta with Content v3 properties
 */
describe('walkMeta', () => {
  it('should skip Content v2 internal properties (starting with _)', () => {
    const content: ParsedContent = {
      _id: 'test',
      _source: 'content',
      _dir: 'blog',
      _path: '/blog/test',
      _file: 'blog/test.md',
      _type: 'markdown',
      _extension: 'md',
      body: { type: 'root', children: [] },
      image: './cover.png',
    }

    const visited: Array<{ key: string; value: any }> = []
    walkMeta(content, (value: any, parent: any, key: string) => {
      visited.push({ key, value })
    })

    // Should visit 'image' but not any _-prefixed keys or 'body'
    expect(visited.some(v => v.key === 'image')).toBe(true)
    expect(visited.some(v => v.key === '_id')).toBe(false)
    expect(visited.some(v => v.key === '_file')).toBe(false)
    expect(visited.some(v => v.key === 'body')).toBe(false)
  })

  it('should skip Content v3 system properties', () => {
    // Simulate a Content v3-like object with _file set for resolution
    const content: any = {
      _id: 'test-id',
      _file: 'blog/test.md',
      _extension: 'md',
      id: 'content:blog:test.md',
      path: '/blog/test',
      stem: 'test',
      extension: '.md',
      body: { type: 'minimark', value: [] },
      meta: { extraField: 'value' },
      seo: { title: 'Test' },
      image: './cover.png',
      thumbnail: './thumb.png',
    }

    const visitedKeys: string[] = []
    walkMeta(content, (_value: any, _parent: any, key: string) => {
      visitedKeys.push(key)
    })

    // Should visit user-defined properties
    expect(visitedKeys).toContain('image')
    expect(visitedKeys).toContain('thumbnail')
    // Should NOT visit system properties
    expect(visitedKeys).not.toContain('id')
    expect(visitedKeys).not.toContain('path')
    expect(visitedKeys).not.toContain('stem')
    expect(visitedKeys).not.toContain('extension')
    expect(visitedKeys).not.toContain('body')
    expect(visitedKeys).not.toContain('meta')
    expect(visitedKeys).not.toContain('seo')
    expect(visitedKeys).not.toContain('_id')
    expect(visitedKeys).not.toContain('_file')
  })
})
