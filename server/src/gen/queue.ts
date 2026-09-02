import type { Shot, Clip } from '@h3/protocol/types'
import type { VideoProvider, FrameLinker } from '../interfaces/provider'
import type { ErrorPolicy } from '../interfaces/error'
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
  /** 错误分类器：fatal 立即抛出由上游停机，retryable 退避重试，swallow 放弃 */
  errorPolicy: ErrorPolicy
  /** 改写 prompt 的入口（由 LiveStream 注入）；422 触发后调用一次 */
  rewritePrompt?: (prompt: string) => Promise<string>
  onLog?: (msg: string) => void
}

/**
 * 生成调度器：并发池 + 优先级 + 重试/退避。
 * 每个 worker：先做"首帧续接"（上一完成镜头的末帧），再调视频 Provider 生成。
 * 错误处理全部交给 ErrorPolicy，GenQueue 不识别具体错误类型。
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

  get pendingCount(): number { return this.pending.length }
  get running(): number { return this.runningCount }
  get produced(): number { return this.stats.produced }
  get failed(): number { return this.stats.failed }

  enqueue(shot: Shot | Shot[], priority = 0): void {
    const shots = Array.isArray(shot) ? shot : [shot]
    for (const s of shots) this.pending.push({ shot: s, priority, attempts: 0, rewritten: false })
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
      if (this.lastReadyPath && this.linker) {
        try {
          firstFrame = await this.linker.extractLastFrame(this.lastReadyPath)
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
      const severity = this.opts.errorPolicy.classify(err)
      if (severity === 'retryable' && job.attempts < this.opts.maxRetries) {
        job.attempts++
        const backoffMs = Math.min(30_000, 1000 * 2 ** job.attempts) // 2s/4s/8s/16s/30s
        this.ev.onLog(`⚠️ 镜头 ${job.shot.id} 失败(${err.message})，${job.attempts}/${this.opts.maxRetries} 次重试，${backoffMs}ms 后`)
        // 用 setTimeout 而不是 sleep：sleep 期间 runningCount 不减会占 worker slot 阻塞并发。
        // setTimeout 触发后再把 job 放回 pending 并 pump。
        setTimeout(() => {
          if (this.stopFlag) return
          this.pending.push(job)
          this.pump()
        }, backoffMs)
        return // 不重抛，外层 finally 立刻执行 runningCount--
      } else if (severity === 'swallow' && this.opts.rewritePrompt && !job.rewritten) {
        // 422 类内容拦截：尝试改写一次
        try {
          job.shot.prompt = await this.opts.rewritePrompt(job.shot.prompt)
          job.rewritten = true
          this.ev.onLog(`✏️ 镜头 ${job.shot.id} 触发敏感词拦截，已改写 prompt 后重试`)
          this.pending.push(job)
          return
        } catch {
          /* 改写失败，按 fatal 走 */
        }
        this.ev.onLog(`❌ 镜头 ${job.shot.id} 生成失败，已停止: ${err.message}`)
        this.ev.onShotFailed(job.shot.id, err)
      } else {
        // fatal 或重试耗尽
        const stderr = (err as Error & { stderr?: Buffer | string }).stderr?.toString().trim()
        const stdout = (err as Error & { stdout?: Buffer | string }).stdout?.toString().trim()
        const extra = [stderr && `stderr=${stderr}`, stdout && `stdout=${stdout}`].filter(Boolean).join(' | ')
        this.ev.onLog(`❌ 镜头 ${job.shot.id} 生成失败，已停止: ${err.message}${extra ? `  [${extra}]` : ''}`)
        this.ev.onShotFailed(job.shot.id, err)
      }
    }
  }
}