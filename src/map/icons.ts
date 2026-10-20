import type { Map as MlMap } from 'maplibre-gl'

/**
 * 饮食（菱形）和住宿（圆角方块）的图标。画成 SDF，这样颜色、描边都可以用 paint 属性改，
 * 换主题、高亮时不用重画。编码和 MapLibre 的 tiny-sdf 一致：半径 8 像素，边缘在 alpha = 0.75。
 */
const SIZE = 32
const RATIO = 2

function box(x: number, y: number, h: number, r: number) {
  const qx = Math.abs(x) - (h - r)
  const qy = Math.abs(y) - (h - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function sdf(dist: (x: number, y: number) => number) {
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = dist(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2)
      data[(y * SIZE + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(191.25 - 31.875 * d)))
    }
  }
  return { width: SIZE, height: SIZE, data }
}

const SHAPES: Record<string, (x: number, y: number) => number> = {
  'ic-food': (x, y) => box((x + y) / Math.SQRT2, (y - x) / Math.SQRT2, 7.5, 1.2),
  'ic-stay': (x, y) => box(x, y, 8, 2),
}

export function addIcons(map: MlMap) {
  for (const [id, f] of Object.entries(SHAPES)) {
    if (!map.hasImage(id)) map.addImage(id, sdf(f), { sdf: true, pixelRatio: RATIO })
  }
}
