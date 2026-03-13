// ---------------------------------------------------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------------------------------------------------

export interface ModuleOptions {
  /**
   * Image size hints
   *
   * @example 'attrs style url'
   * @default 'style'
   */
  imageSize?: string | string[] | false

  /**
   * List of content extensions; anything else as an asset
   *
   * @example 'md'
   * @default 'md csv ya?ml json'
   */
  contentExtensions?: string | string[],

  /**
   * Display debug messages
   *
   * @example true
   * @default false
   */
  debug?: boolean
}

// ---------------------------------------------------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------------------------------------------------

export type ImageSize = Array<'style' | 'src' | 'url' | 'attrs'>

export type AssetConfig = {
  srcAttr: string
  content: string[],
  width?: number
  height?: number
}

export interface AssetMessage {
  event: 'update' | 'remove' | 'refresh'
  src?: string
  width?: string
  height?: string
}

// ---------------------------------------------------------------------------------------------------------------------
// content source
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Options for a content source mount
 *
 * Compatible with both Nuxt Content v2 MountOptions and v3 source configuration
 */
export interface ContentSourceOptions {
  driver: string
  base: string
  prefix?: string
  [key: string]: any
}

// ---------------------------------------------------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Parsed content structure (compatible with both Content v2 and v3)
 */
export interface ParsedContent {
  /**
   * Content v2: The storage id of the file
   * @example 'content:foo:bar:index.md'
   */
  _id: string

  /**
   * Content v2: The source group identifier
   * @example 'content'
   */
  _source: string

  /**
   * Content v2: The directory of the file under _source
   * @example 'foo'
   */
  _dir: string

  /**
   * Content v2: The route to the file (excluding _source)
   * @example '/foo/bar'
   */
  _path: string

  /**
   * Content v2: The file path of the file (excluding _source)
   * @example 'foo/bar/index.md'
   */
  _file: string

  /**
   * Content v2: The type of the file
   * @example 'markdown'
   */
  _type: string

  /**
   * Content v2: The file extension (excluding the dot)
   * @example 'md'
   */
  _extension: string

  /**
   * The AST structure
   *
   * Content v2: hast-based MDC AST { type: 'root', children: [...] }
   * Content v3: minimark tree { type: 'minimark', value: [...] }
   */
  body: {
    type: string,
    children?: Array<any>
    value?: Array<any>
  }

  /**
   * Any other metadata key
   * @see https://content.nuxtjs.org/guide/writing/markdown/#native-parameters
   */
  [key: string | '_draft' | '_partial' | '_locale' | '_empty' | 'title' | 'description' | 'excerpt']: any
}

// ---------------------------------------------------------------------------------------------------------------------
// sockets
// ---------------------------------------------------------------------------------------------------------------------

export type Callback = (data: any) => void

export interface SocketInstance {
  send: (data: any) => SocketInstance
  addHandler: (handler: Callback) => SocketInstance
}
