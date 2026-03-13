import * as Fs from 'fs'
import Path from 'crosspath'
import { addPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import { isImage, list, log, warn, makeIgnores, matchTokens, removeEntry, toPath } from './runtime/utils'
import { setupSocketServer } from './build/sockets/setup'
import { makeSourceManager } from './runtime/assets/source'
import { makeAssetsManager } from './runtime/assets/public'
import { rewriteContent } from './runtime/content/parsed'
import type { ModuleMeta, Nuxt, NuxtConfigLayer } from '@nuxt/schema'
import type { ContentSourceOptions, ImageSize, ModuleOptions, ParsedContent } from './types'

// Re-export types for consumers
export type {
  ModuleOptions,
  ImageSize,
  AssetConfig,
  AssetMessage,
  SocketInstance
} from './types'

const resolve = createResolver(import.meta.url).resolve

const meta: ModuleMeta = {
  name: 'nuxt-content-assets',
  configKey: 'contentAssets',
  compatibility: {
    nuxt: '>=3.0.0',
  },
}

/**
 * Detect if Nuxt Content v3 is in use
 *
 * Content v3 uses collections instead of sources,
 * and the content:file:afterParse hook is a Nuxt build-time hook
 * rather than a Nitro runtime hook.
 */
function isContentV3 (nuxt: Nuxt): boolean {
  // Primary detection: try to read the installed @nuxt/content version
  try {
    const contentPkgPath = require.resolve('@nuxt/content/package.json', {
      paths: [nuxt.options.rootDir],
    })
    const contentPkg = JSON.parse(Fs.readFileSync(contentPkgPath, 'utf-8'))
    const version = contentPkg.version
    if (version) {
      const major = parseInt(version.split('.')[0], 10)
      if (major >= 3) return true
      if (major <= 2) return false
    }
  }
  catch {
    // package resolution failed, fall back to config-based detection
  }

  // Fallback: detect from content config shape
  const contentConfig = (nuxt.options as any).content
  if (contentConfig && typeof contentConfig === 'object') {
    // Content v3 uses database/collections-based config
    if ('database' in contentConfig) {
      return true
    }
    // Content v2 uses sources
    if ('sources' in contentConfig) {
      return false
    }
  }
  return false
}

export default defineNuxtModule<ModuleOptions>({
  meta,

  defaults: {
    imageSize: '',
    contentExtensions: 'mdx? csv ya?ml json',
    debug: false,
  },

  async setup (options: ModuleOptions, nuxt: Nuxt) {
    // ---------------------------------------------------------------------------------------------------------------------
    // paths
    // ---------------------------------------------------------------------------------------------------------------------

    // nuxt build folder (.nuxt)
    const buildPath = nuxt.options.buildDir

    // node modules folder (note: from v1.4.1 the assets cache moved from .nuxt/... to node_modules/... @see #76)
    const modulesPath = nuxt.options.modulesDir.find((path: string) => Fs.existsSync(`${path}/nuxt-content-assets/cache`)) || ''
    if (!modulesPath) {
      warn('Unable to find cache folder!')
      if (nuxt.options.rootDir.endsWith('/playground')) {
        warn('Run "npm run dev:setup" to generate a new cache folder')
      }
    }

    // assets cache (node_modules/nuxt-content-assets/cache)
    const cachePath = modulesPath
      ? Path.resolve(modulesPath, 'nuxt-content-assets/cache')
      : Path.resolve(buildPath, 'content-assets') // TODO check if fallback even works?

    // public folder (node_modules/nuxt-content-assets/cache/public)
    const publicPath = Path.join(cachePath, 'public')

    // content cache (.nuxt/content-cache)
    const contentPath = Path.join(buildPath, 'content-cache')

    // ---------------------------------------------------------------------------------------------------------------------
    // setup
    // ---------------------------------------------------------------------------------------------------------------------

    // options
    const isDev = !!nuxt.options.dev
    const isDebug = !!options.debug

    // detect Content version
    const useContentV3 = isContentV3(nuxt)
    if (isDebug) {
      log(`Detected Nuxt Content ${useContentV3 ? 'v3' : 'v2'}`)
    }

    // clear caches
    if (isDebug) {
      log('Cleaning content-cache')
      log(`Cache path: "${Path.relative(".", cachePath)}"`)
    }

    // clear cached markdown so image paths get updated
    removeEntry(contentPath)

    // ---------------------------------------------------------------------------------------------------------------------
    // options
    // ---------------------------------------------------------------------------------------------------------------------

    // set up content ignores (Content v2 only; v3 uses collections with explicit sources)
    if (!useContentV3) {
      const { contentExtensions } = options
      if (contentExtensions) {
        // @ts-ignore
        nuxt.options.content ||= {}
        if (nuxt.options.content) {
          (nuxt.options.content as any).ignores ||= []
        }
        const ignores = makeIgnores(contentExtensions)
        if (ignores.length) {
          (nuxt.options.content as any)?.ignores.push(ignores)
        }
      }
    }

    // convert image size hints to array
    const imageSizes: ImageSize = matchTokens(options.imageSize) as ImageSize

    // collate sources
    type Sources = Record<string, ContentSourceOptions>
    const sources: Sources = collateSources(nuxt, useContentV3)

    // ---------------------------------------------------------------------------------------------------------------------
    // assets
    // ---------------------------------------------------------------------------------------------------------------------

    /**
     * Assets manager
     */
    const assets = makeAssetsManager(publicPath, isDev)

    // clear files from previous run
    assets.init()

    /**
     * Callback for when assets change
     *
     * - if the asset is updated or deleted, we tell the browser to update the asset's properties
     * - if the asset is an image and changes size, we also rewrite the cached content
     *
     * @param event   The type of update
     * @param absTrg  The absolute path to the copied asset
     */
    function onAssetChange (event: 'update' | 'remove', absTrg: string) {
      let src: string = ''
      let width: number | undefined
      let height: number | undefined

      // update
      if (event === 'update') {
        // 1. get the old asset config first...
        const oldAsset = isImage(absTrg) && imageSizes.length
          ? assets.getAsset(absTrg)
          : null

        // 2. ...before the asset overwrites the image size
        const newAsset = assets.setAsset(absTrg)

        // sizes
        width = newAsset.width
        height = newAsset.height

        // check for image size change
        if (oldAsset) {
          // special behaviour for image size change!
          // we rewrite cached content directly so image size changes are permanent
          if (oldAsset.width !== newAsset.width || oldAsset.height !== newAsset.height) {
            newAsset.content.forEach(async (id: string) => {
              const path = Path.join(contentPath, 'parsed', toPath(id))
              rewriteContent(path, newAsset)
            })
          }
        }

        // set src
        src = newAsset.srcAttr
      }

      // remove
      else {
        const asset = assets.removeAsset(absTrg)
        if (asset) {
          src = asset.srcAttr
        }
      }

      // sockets
      if (src && socket) {
        socket.send({ event, src, width, height })
      }
    }

    /**
     * Socket to communicate changes to client
     */
    addPlugin(resolve('./runtime/sockets/plugin'))
    const socket = isDev && (nuxt.options as any).content?.watch !== false
      ? await setupSocketServer('content-assets')
      : null

    // ---------------------------------------------------------------------------------------------------------------------
    // sources
    // ---------------------------------------------------------------------------------------------------------------------

    // create source managers
    const managers: Record<string, ReturnType<typeof makeSourceManager>> = {}
    for (const [key, source] of Object.entries(sources)) {
      // debug
      if (isDebug) {
        log(`Creating source "${key}"`)
      }

      // create manager
      managers[key] = makeSourceManager(key, source, publicPath, onAssetChange)
    }

    // store the source base dirs for Content v3 file path resolution
    const sourceBaseDirs: string[] = Object.values(sources)
      .filter(s => s.driver === 'fs')
      .map(s => Path.resolve(s.base))

    // ---------------------------------------------------------------------------------------------------------------------
    // nuxt hooks
    // ---------------------------------------------------------------------------------------------------------------------

    /**
     * Initialize assets: copy to public folder
     *
     * For Content v3, this must happen before modules:done (when content is parsed).
     * For Content v2, this happens in build:before (when content is parsed at runtime).
     */
    async function initializeAssets () {
      for (const [key, manager] of Object.entries(managers)) {
        // copy assets
        const paths = await manager.init()

        // update assets config
        paths.forEach(path => assets.setAsset(path))

        // debug
        if (isDebug) {
          list(`Copied "${key}" assets`, paths.map(path => Path.relative(publicPath, path)))
        }
      }
    }

    if (useContentV3) {
      // For Content v3: initialize assets immediately during setup
      // This ensures assets are indexed before content:file:afterParse fires
      await initializeAssets()
    }
    else {
      // For Content v2: copy assets in build:before hook
      nuxt.hook('build:before', initializeAssets)
    }

    // cleanup when nuxt closes
    nuxt.hook('close', async () => {
      await assets.dispose()
      for (const key in managers) {
        await managers[key]?.dispose()
      }
    })

    // ---------------------------------------------------------------------------------------------------------------------
    // Content v3: Nuxt build-time hook for content processing
    // ---------------------------------------------------------------------------------------------------------------------

    if (useContentV3) {
      // Import content processing utilities
      const { processMeta, processBody } = await import('./runtime/content/process')

      /**
       * Content v3 hook context
       *
       * In Content v3, content:file:afterParse is a Nuxt build-time hook that receives
       * the parsed file info and content for each content file during build.
       */
      interface ContentV3HookContext {
        file: { id: string; path: string; dirname?: string; extension?: string }
        content: ParsedContent & Record<string, any>
        collection?: any
      }

      nuxt.hook('content:file:afterParse' as any, function (ctx: ContentV3HookContext) {
        const { file, content } = ctx
        if (!content || !file) {
          return
        }

        // only process markdown files
        const ext = file.extension || (file.path ? '.' + file.path.split('.').pop() : '')
        if (ext !== '.md' && ext !== '.mdx') {
          return
        }

        // compute the relative file path (equivalent to content._file in Content v2)
        const relFile = getRelativeFilePath(file.path, sourceBaseDirs)

        if (!relFile) {
          return
        }

        // create a normalized content object compatible with Content v2 format
        // so the existing asset resolution logic can work
        const normalizedContent: ParsedContent = {
          ...content,
          _id: content._id || content.id || file.id,
          _source: content._source || '',
          _dir: content._dir || '',
          _path: content._path || '',
          _file: relFile,
          _type: content._type || 'markdown',
          _extension: (ext || '').replace(/^\./, ''),
        }

        // process meta and body using the asset manager
        const updated: string[] = []
        processMeta(normalizedContent, imageSizes, assets, isDebug, updated)
        processBody(normalizedContent, imageSizes, assets, isDebug, updated)

        if (isDebug && updated.length) {
          list(`Processed "/${relFile}"`, updated)
        }

        // copy modifications back to the original content object
        if (normalizedContent.body) {
          content.body = normalizedContent.body
        }

        // copy any modified meta properties back
        for (const key of Object.keys(normalizedContent)) {
          if (!key.startsWith('_') && key !== 'body' && key !== 'id') {
            content[key] = normalizedContent[key]
          }
        }
      })
    }

    // ---------------------------------------------------------------------------------------------------------------------
    // Content v2: nitro hook (via plugin)
    // ---------------------------------------------------------------------------------------------------------------------

    // plugin
    const pluginPath = resolve('./runtime/content/plugin')

    // config
    const makeVar = (name: string, value: any) => `export const ${name} = ${JSON.stringify(value)};`
    const virtualConfig = [
      makeVar('publicPath', publicPath),
      makeVar('imageSizes', imageSizes),
      makeVar('debug', isDebug),
    ].join('\n')

    // setup server plugin
    nuxt.hook('nitro:config', async (config) => {
      // add plugin (Content v2 uses nitro plugin for runtime content processing)
      if (!useContentV3) {
        config.plugins ||= []
        config.plugins.push(pluginPath)
      }

      // make config available to nitro
      config.virtual ||= {}
      config.virtual[`#${meta.name}`] = () => {
        return virtualConfig
      }

      // serve public assets
      config.publicAssets ||= []
      config.publicAssets.push({
        dir: publicPath,
        maxAge: (60 * 60 * 24) * 7, // 7 days
      })
    })
  },
})

/**
 * Collate content sources from Nuxt layers
 *
 * For Content v2: reads from layer.config.content.sources
 * For Content v3: scans for 'content/' directories in each layer
 */
function collateSources (nuxt: Nuxt, useContentV3: boolean): Record<string, ContentSourceOptions> {
  type Sources = Record<string, ContentSourceOptions>

  if (useContentV3) {
    // Content v3: find content directories from layers
    const sources: Sources = {}

    // check each layer for a content directory
    const layers = Array.from(nuxt.options._layers)
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerDir = layer.config?.srcDir || layer.config?.rootDir || ''
      if (!layerDir) continue

      const contentDir = Path.resolve(layerDir, 'content')
      if (Fs.existsSync(contentDir)) {
        const key = i === 0 ? 'content' : `layer-${i}`
        sources[key] = {
          driver: 'fs',
          base: contentDir,
        }
      }
    }

    // fallback: check root content directory
    if (Object.keys(sources).length === 0) {
      const content = Path.resolve(nuxt.options.rootDir, 'content')
      if (Fs.existsSync(content)) {
        sources.content = {
          driver: 'fs',
          base: content,
        }
      }
    }

    return sources
  }
  else {
    // Content v2: read from layer.config.content.sources
    const sources: Sources = Array
      .from(nuxt.options._layers)
      .map((layer: NuxtConfigLayer) => (layer.config as any)?.content?.sources)
      .reduce((output: Sources, sources) => {
        if (sources && !Array.isArray(sources)) {
          Object.assign(output, sources as Sources)
        }
        return output
      }, {})

    // add default content folder
    if (Object.keys(sources).length === 0 || !sources.content) {
      const content = nuxt.options.rootDir + '/content'
      if (Fs.existsSync(content)) {
        sources.content = {
          driver: 'fs',
          base: content,
        }
      }
    }

    return sources
  }
}

/**
 * Get the relative file path from an absolute path and known source directories
 *
 * @param absPath   The absolute file path
 * @param baseDirs  Array of known content source base directories
 * @returns The relative path, or empty string if not found
 */
function getRelativeFilePath (absPath: string, baseDirs: string[]): string {
  if (!absPath) return ''

  for (const dir of baseDirs) {
    if (absPath.startsWith(dir)) {
      return Path.relative(dir, absPath)
    }
  }

  // fallback: try to extract from the path by finding 'content/' segment
  const contentIdx = absPath.indexOf('/content/')
  if (contentIdx >= 0) {
    return absPath.substring(contentIdx + '/content/'.length)
  }

  return ''
}
