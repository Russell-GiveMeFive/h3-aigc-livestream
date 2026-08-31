import { TextProvider } from '../providers/text'
import { Beat, StoryState } from '../types'
import { sleep } from '../util'
import { continueStory } from './continuer'
import { GenQueue } from '../gen/queue'
import { PlayoutEngine } from '../playout/engine'

export interface DirectorOptions {
  targetBufferSec: number
  /** 队列里最多允许排队的镜头数（含运行中），防止 LLM 空转烧钱 */
  maxAheadShots: number
  onBeat?: (beat: Beat) => void
  onLog: (msg: string) => void
}

/**
 * 导演引擎（M1 极简版）：维持"播放缓冲水位"。
 * 缓冲低于目标且队列有余量 → 调用续写器拿下一拍 → 分镜入生成队列。
 * M2 将在此加入弹幕反馈与三种续写模式/导演模式切换。
 */
export class Director {
  private stopFlag = false
  private loopPromise: Promise<void> | null = null

  constructor(
    private state: StoryState,
    private provider: TextProvider,
    private queue: GenQueue,
    private playout: PlayoutEngine,
    private opts: DirectorOptions,
  ) {}

  async start(): Promise<void> {
    this.loopPromise = this.loop()
    await this.loopPromise
  }

  async stop(): Promise<void> {
    this.stopFlag = true
    await this.loopPromise?.catch(() => {})
  }

  private async loop(): Promise<void> {
    while (!this.stopFlag) {
      const buffered = this.playout.bufferedSec
      const ahead = this.queue.pendingCount + this.queue.running
      const room = this.opts.maxAheadShots - ahead
      if (buffered < this.opts.targetBufferSec && room > 0) {
        try {
          const beat = await continueStory(this.provider, this.state)
          this.state.beats.push(beat)
          this.opts.onBeat?.(beat)
          for (const shot of beat.shots) this.queue.enqueue(shot)
          this.opts.onLog(`📝 续写剧情拍 #${this.state.beats.length}: ${beat.summary}`)
        } catch (e) {
          this.opts.onLog(`⚠️ 续写失败: ${(e as Error).message}，5s 后重试`)
          await sleep(5000)
        }
      }
      await sleep(1000)
    }
  }
}
