import type { NitroApp, NitroAppPlugin } from 'nitropack'
import type { ImageSize, ParsedContent } from '../../types'
import { list } from '../utils'
import { processMeta, processBody } from './process'
import { makeAssetsManager } from '../assets/public'
// @ts-ignore – options injected via module.ts
import { debug, imageSizes, publicPath } from '#nuxt-content-assets'

const plugin: NitroAppPlugin = async (nitro: NitroApp) => {
  const assets = makeAssetsManager(publicPath, import.meta.dev)

  // @ts-ignore hook name
  nitro.hooks.hook('content:file:afterParse', function (content: ParsedContent) {
    if (content._extension === 'md') {
      const updated: string[] = []
      processMeta(content, imageSizes, assets, debug, updated)
      processBody(content, imageSizes, assets, debug, updated)
      if (debug && updated.length) {
        list(`Processed "/${content._file}"`, updated)
        console.log()
      }
    }
  })

  nitro.hooks.hook('close', assets.dispose)
}

export default plugin
