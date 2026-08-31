import { FrameLinker } from './frameLink'
import { ApiError } from '../providers/minimax'
import { VideoProvider } from '../providers/video'
import { Clip, Shot } from '../types'
import { sleep } from '../util'

export interface GenQueueEvents {
  onShotStart: (shotId: string) => void
  onClipReady: (clip: Clip) => void
  onLog: (msg: string) => void
  onShotFailed: (shotId: string, error: Error) => void
  onLatency: (ms: number) => void
}

interface Job {
  shot: Shot
  priority: number
  attempts: number
  rewritten: boolean
}

export interface GenQueueOptions {
  concurrency: number
  maxRetries: number
  /** 422 敏感内容时用文本模型改写 prompt 后重试（可选） */
  rewritePrompt?: (prompt: string) => Promise<string>
  onLog?: (msg: string) => void
}

/**
 * 生成调度器：并发池 + 优先级 + 重试/退避。
 * 每个 worker：先做"首帧续接"（上一完成镜头的末帧），再调视频 Provider 生成。
 * 429/500/529/504 退避重试；422 触发 prompt 改写后重试一次。
 */
export class GenQueue {
  private pending: Job[] = []
  private runningCount = 0
  private stopFlag = false
  private lastReadyPath: string | undefined
  private stats = { produced: 0, failed: 0 }
  private jobs = new Set<Promise<void>>()

  constructor(
    private provider: VideoProvider,
    private linker: FrameLinker | undefined,
    private ev: GenQueueEvents,
    private opts: GenQueueOptions,
  ) {}

  get pendingCount(): number {
    return this.pending.length
  }

  get running(): number {
    return this.runningCount
  }

  get produced(): number {
    return this.stats.produced
  }

  get failed(): number {
    return this.stats.failed
  }

  enqueue(shot: Shot, priority = 0): void {
    this.pending.push({ shot, priority, attempts: 0, rewritten: false })
    this.pump()
  }

  async stop(): Promise<void> {
    this.stopFlag = true
    this.pending = []
    await Promise.allSettled([...this.jobs])
  }

  private pump(): void {
    while (!this.stopFlag && this.runningCount < this.opts.concurrency && this.pending.length) {
      this.pending.sort((a, b) => b.priority - a.priority)
      const job = this.pending.shift()!
      this.runningCount++
      const task = this.runJob(job).catch(() => {})
      this.jobs.add(task)
      void task.finally(() => {
        this.jobs.delete(task)
        this.runningCount--
        this.pump()
      }).catch(() => {})
    }
  }

  private async runJob(job: Job): Promise<void> {
    const t0 = Date.now()
    try {
      if (this.stopFlag) return
      this.ev.onShotStart(job.shot.id)
      let firstFrame: string | undefined
      // 首帧续接：用"最近完成"的镜头末帧锚定本镜头首帧（生成顺序≈播放顺序，M1 接受轻微竞态）
      if (this.lastReadyPath && this.linker) {
        try {
          firstFrame = await this.linker.link(this.lastReadyPath)
        } catch (e) {
          this.ev.onLog(`⚠️ 首帧抽取/上传失败(${(e as Error).message})，本镜头降级为文生视频`)
        }
      }
      const res = await this.provider.generate(job.shot, { firstFrame })
      if (this.stopFlag) return
      this.lastReadyPath = res.localPath
      this.stats.produced++
      this.ev.onLatency(Date.now() - t0)
      this.ev.onClipReady({
        id: `clip_${this.stats.produced}`,
        shotId: job.shot.id,
        path: res.localPath,
        duration: res.duration,
        readyAt: Date.now(),
      })
    } catch (e) {
      this.stats.failed++
      const err = e as Error
      if (this.isRetryable(err, job) && job.attempts < this.opts.maxRetries) {
        job.attempts++
        // 422 敏感内容：先用文本模型改写 prompt 再重试（仅一次）
        if (err instanceof ApiError && err.httpCode === 422 && this.opts.rewritePrompt && !job.rewritten) {
          try {
            job.shot.prompt = await this.opts.rewritePrompt(job.shot.prompt)
            job.rewritten = true
            this.ev.onLog(`✏️ 镜头 ${job.shot.id} 触发敏感词拦截，已改写 prompt 后重试`)
          } catch {
            /* 改写失败则按普通重试处理 */
          }
        }
        this.pending.push(job)
        this.ev.onLog(`⚠️ 镜头 ${job.shot.id} 失败(${err.message})，${job.attempts}/${this.opts.maxRetries} 次重试`)
        await sleep(3000)
        if (this.stopFlag) return
      } else {
        this.ev.onLog(`❌ 镜头 ${job.shot.id} 生成失败，已放弃: ${err.message}`)
        this.ev.onShotFailed(job.shot.id, err)
      }
    }
  }

  private isRetryable(err: Error, job: Job): boolean {
    if (err instanceof ApiError) {
      const code = err.httpCode
      // 422 敏感内容：仅当还能用文本模型改写 prompt 时才重试一次
      if (code === 422) return !job.rewritten && !!this.opts.rewritePrompt
      // 限流 / 过载 / 服务端错误 / 超时：退避重试
      if (code === 429 || code === 500 || code === 529 || code === 504 || code === 503) return true
      // 402 余额不足等：不可重试，导演应停机
      return false
    }
    return false
  }
}
