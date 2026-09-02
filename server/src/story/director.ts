import type { StoryState } from '@h3/protocol/types'
import type { DirectorContext, DirectorHooks, DirectorStrategy } from '../interfaces/story'

export interface DirectorDeps {
  state: StoryState
  provider: import('../interfaces/provider').TextProvider
  hooks: DirectorHooks
  strategy: DirectorStrategy
  /** 由 LiveStream 提供，使 Director 能查 playout/queue 当前水位 */
  getBufferedSec: () => number
  getPendingShots: () => number
  getRunningShots: () => number
  cfg: { targetBufferSec: number; maxAheadShots: number }
}

/**
 * Director 调度器：循环 poll 水位 → 调 strategy.tick 决定是否补一拍。
 * 真正的续写逻辑（ai / suggest / crowd）由 DirectorStrategy 实现。
 */
export class Director {
  private stopFlag = false
  private loopPromise: Promise<void> | null = null

  constructor(private readonly deps: DirectorDeps) {}

  /** splitter 完成后，把完整 ScriptPlan 注入 Director（让续写能拿到 storyState） */
  setState(state: StoryState): void {
    this.deps.state = state
  }

  async start(): Promise<void> {
    if (this.loopPromise) return
    this.stopFlag = false
    this.loopPromise = this.loop()
    await this.loopPromise
  }

  async stop(): Promise<void> {
    this.stopFlag = true
    const p = this.loopPromise
    this.loopPromise = null
    await p?.catch(() => {})
  }

  private async loop(): Promise<void> {
    while (!this.stopFlag) {
      const ctx: DirectorContext = {
        state: this.deps.state,
        provider: this.deps.provider,
        bufferedSec: this.deps.getBufferedSec(),
        pendingShots: this.deps.getPendingShots(),
        runningShots: this.deps.getRunningShots(),
        maxAheadShots: this.deps.cfg.maxAheadShots,
        targetBufferSec: this.deps.cfg.targetBufferSec,
        hooks: this.deps.hooks,
      }
      try {
        await this.deps.strategy.tick(ctx)
      } catch (e) {
        this.deps.hooks.onLog(`⚠️ Director tick 异常: ${(e as Error).message}`)
        await new Promise<void>((r) => setTimeout(r, 1000))
      }
    }
  }
}