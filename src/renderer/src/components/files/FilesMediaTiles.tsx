// Files Tab · 超大位图的瓦片层：OpenSeadragon 只取可见瓦片（Deep Zoom 金字塔由主进程 sharp 生成，ADR-0029）。
// 关掉它自带的鼠标导航，由看图组件的相机（files-media-zoom）驱动视口，手感与普通图完全一致。
import OpenSeadragon from 'openseadragon'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { buildFilesTileUrl } from '@shared/files'
import { imageTileMime, imageTileRelPath, type FilesImagePyramid } from '@shared/files-image-tiles'
import { mediaCameraToViewport, type MediaCamera } from '@renderer/lib/files-media-zoom'

export type MediaTilesHandle = {
  /** 把相机同步到瓦片视口；金字塔尚未 open 时记下，open 后立即套用。 */
  apply(cam: MediaCamera, naturalW: number, naturalH: number, availW: number, availH: number): void
}

type ApplyArgs = Parameters<MediaTilesHandle['apply']>

export function FilesMediaTiles({
  ref,
  pyramid
}: {
  ref: Ref<MediaTilesHandle>
  pyramid: FilesImagePyramid
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const openRef = useRef(false)
  const pendingRef = useRef<ApplyArgs | null>(null)

  const applyNow = (args: ApplyArgs): void => {
    const viewer = viewerRef.current
    if (!viewer || !openRef.current) return
    const m = mediaCameraToViewport(...args)
    viewer.viewport.zoomTo(m.zoom, undefined, true)
    viewer.viewport.panTo(new OpenSeadragon.Point(m.centerX, m.centerY), true)
  }

  useImperativeHandle(
    ref,
    () => ({
      apply: (...args) => {
        pendingRef.current = args
        applyNow(args)
      }
    }),
    []
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const mime = imageTileMime(pyramid.format)
    const viewer = OpenSeadragon({
      element: host,
      // 自定义瓦片源：层级按 Deep Zoom 约定（maxLevel = ceil(log2(长边))，OSD 默认即此）
      tileSources: {
        width: pyramid.width,
        height: pyramid.height,
        tileSize: pyramid.tileSize,
        tileOverlap: pyramid.overlap,
        minLevel: 0,
        getTileUrl: (level: number, x: number, y: number) =>
          buildFilesTileUrl(pyramid.key, imageTileRelPath(level, x, y, pyramid.format), mime)
      },
      // WebGL 需要 CORS 干净的瓦片（协议已带 Access-Control-Allow-Origin）；不可用时退回 canvas
      drawer: ['webgl', 'canvas'],
      crossOriginPolicy: 'Anonymous',
      mouseNavEnabled: false,
      showNavigationControl: false,
      showNavigator: false,
      immediateRender: true,
      animationTime: 0,
      blendTime: 0,
      // 约束交给相机：不夹紧、不限倍率
      constrainDuringPan: false,
      visibilityRatio: 0,
      minZoomImageRatio: 0,
      maxZoomPixelRatio: Number.POSITIVE_INFINITY,
      imageSmoothingEnabled: true
    })
    viewer.addOnceHandler('open', () => {
      openRef.current = true
      if (pendingRef.current) applyNow(pendingRef.current)
    })
    viewerRef.current = viewer
    return () => {
      openRef.current = false
      viewerRef.current = null
      viewer.destroy()
    }
  }, [pyramid])

  return <div ref={hostRef} className="absolute inset-0" />
}
