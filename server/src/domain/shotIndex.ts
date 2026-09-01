import type { ShotView } from '@h3/protocol/types'

/** 镜头在 beatViews 里的 (beatIdx, shotIdx) 引用 */
export interface ShotRef { beatIdx: number; shotIdx: number }

/** 给一组 Beat 建派生 shot→位置索引（不改 beatViews 结构） */
export function buildShotIndex(beats: ShotView[][]): Map<string, ShotRef> {
  const m = new Map<string, ShotRef>()
  beats.forEach((shots, beatIdx) => {
    shots.forEach((s, shotIdx) => m.set(s.id, { beatIdx, shotIdx }))
  })
  return m
}