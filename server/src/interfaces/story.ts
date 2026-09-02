import type { Beat, BeatView, Character, Clip, ClipView, ContinueMode, Shot, ShotView } from '@h3/protocol/types'
import type { TextProvider } from './provider'

/** 剧本首次拆分的产物（用于 LiveStream.start 初始化 StoryState） */
export interface ScriptPlan {
  title: string
  world: string
  characters: Character[]
  entities: string[]
  beats: Beat[]
}

/** 剧本首次拆分（一次性，M1 必跑） */
export interface StorySplitter {
  split(ctx: SplitContext): Promise<ScriptPlan>
}

export interface SplitContext {
  premise: string
  provider: TextProvider
  logger: (msg: string) => void
}

/** 续写下一拍：Director 按 strategy 选择 ai / suggest / crowd */
export interface StoryContinuer {
  continue(ctx: ContinueContext): Promise<Beat>
}

export interface ContinueContext {
  state: import('@h3/protocol/types').StoryState
  provider: TextProvider
  mode: ContinueMode
  logger: (msg: string) => void
  /** suggest/crowd 模式需要的弹幕缓冲；M1 ai 模式可忽略 */
  danmakuFeed?: string[]
}

/** 导演策略：一次 tick 决定"现在该不该补下一拍"并产出 */
export interface DirectorStrategy {
  /** 返回 Beat 表示生成一拍；返回 null 表示本 tick 不动作（让位缓冲） */
  tick(ctx: DirectorContext): Promise<Beat | null>
}

export interface DirectorContext {
  state: import('@h3/protocol/types').StoryState
  provider: TextProvider
  bufferedSec: number
  pendingShots: number
  runningShots: number
  maxAheadShots: number
  targetBufferSec: number
  hooks: DirectorHooks
}

export interface DirectorHooks {
  onBeat(beat: Beat): void
  onLog(msg: string): void
}

// ── 内部辅助：LiveStream 状态机使用的视图类型 ──

export type { ShotView, BeatView, ClipView }
export type { Clip, Shot }