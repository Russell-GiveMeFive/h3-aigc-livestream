import type { EventEmitter } from 'node:events'
import path from 'node:path'
import type {
  Beat,
  BeatView,
  ClipView,
  ContinueMode,
  Shot,
  ShotStatus,
  StoryState,
  StreamPhase,
  StreamStatus,
  VideoResolution,
} from '@h3/protocol/types'
import type { FrameLinker, TextProvider, VideoProvider } from '../interfaces/provider'
import type { Pusher } from '../interfaces/push'
import type { ErrorPolicy } from '../interfaces/error'
import { buildShotIndex } from './shotIndex'

/** 一条直播流所需的全部依赖（组合根工厂在外部组装） */
export interface StreamDeps {
  roomId: string
  script: string
  mock: boolean
  providers: { text: TextProvider; video: VideoProvider; linker: FrameLinker | null }
  errorPolicy: ErrorPolicy
  pusher: Pusher
  bus: EventEmitter
  cfg: StreamConfig
  onLog: (msg: string) => void
}

export interface StreamConfig {
  concurrency: number
  targetBufferSec: number
  maxAheadShots: number
  maxRetries: number
  rtmpUrl: string
  hlsUrl: string
  clipDuration: number
  resolution: VideoResolution
}

/**
 * 一条直播流的组合根：剧本 → 分镜 → 生成队列 → 播放池 → 推流，
 * Director 维持缓冲水位持续续写。
 * 状态、视图索引、生命周期收敛在这里；组件（Queue/Playout/Director/Pusher）
 * 通过 deps 注入。
 */
export class LiveStream {
  readonly roomId: string
  private state: StoryState | null = null
  private phase: StreamPhase = 'idle'
  private errorMsg: string | undefined
  private readonly mode: ContinueMode = 'ai'
  private readonly startedAt = Date.now()
  private lastBeatSummary: string | null = null
  private readonly latencies: number[] = []
  private runToken: string | null = null
  private failed = false
  private consecutiveFails = 0
  private lastFailureAt = 0
  private beatViews: BeatView[] = []
  private clipViews: ClipView[] = []
  private shotIndex = new Map<string, { beatIdx: number; shotIdx: number }>()

  constructor(private readonly deps: StreamDeps) {
    this.roomId = deps.roomId
  }

  get phaseValue(): StreamPhase {
    return this.phase
  }

  /** LiveStream 状态机持有方：导演/GENQ/Pusher 组件由调用方管理 */
  private director: { stop: () => Promise<void> } | null = null
  private queue: {
    pendingCount: number
    running: number
    produced: number
    enqueue: (shot: Shot | Shot[]) => void
    stop: () => Promise<void>
  } | null = null

  /** 给 streamFactory 设置已构造好的组件（解耦 LiveStream 与具体实现） */
  bindComponents(c: {
    director: { stop: () => Promise<void> }
    queue: {
      pendingCount: number
      running: number
      produced: number
      enqueue: (shot: Shot | Shot[]) => void
      stop: () => Promise<void>
    }
  }): void {
    this.director = c.director
    this.queue = c.queue
  }

  async start(plan: import('@h3/protocol/types').Beat[]): Promise<void> {
    if (this.phase === 'splitting' || this.phase === 'running' || this.phase === 'stopping') {
      throw new Error(`直播已在阶段 ${this.phase}，不能重复 start()`)
    }
    const token = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    this.runToken = token
    this.phase = 'splitting'
    try {
      // 拍已由外部 splitter 准备好；这里只入队并启动推流
      if (this.runToken !== token) return
      for (const beat of plan) {
        this.addBeatView(beat)
        this.queue?.enqueue(beat.shots)
        this.deps.bus.emit('beat', { summary: beat.summary, shots: beat.shots.length })
      }
      this.deps.pusher.start()
      this.phase = 'running'
      this.deps.bus.emit('phase', 'running')
    } catch (e) {
      this.runToken = null
      this.phase = 'error'
      this.errorMsg = (e as Error).message
      this.deps.bus.emit('error', this.errorMsg)
      this.deps.bus.emit('phase', 'error')
      this.deps.onLog(`💥 直播启动失败: ${this.errorMsg}`)
      await this.stopComponents()
      throw e
    }
  }

  async stop(): Promise<void> {
    if (this.phase === 'stopped' || this.phase === 'stopping') return
    this.runToken = null
    this.phase = 'stopping'
    await this.stopComponents()
    this.phase = 'stopped'
    this.deps.bus.emit('phase', 'stopped')
    this.deps.onLog('🛑 直播已停止')
  }

  /** 硬故障：余额不足 / 连续失败 — 立即停流水线并广播原因 */
  fail(msg: string): void {
    if (this.failed) return
    this.failed = true
    this.runToken = null
    this.errorMsg = msg
    this.phase = 'error'
    this.deps.onLog(`💥 ${msg}`)
    this.deps.bus.emit('error', msg)
    this.deps.bus.emit('phase', 'error')
    void this.stopComponents()
      .then(() => this.deps.onLog('🛑 流水线已停止（可修改配置后重新开播）'))
      .catch((e) => this.deps.onLog(`⚠️ 流水线清理异常: ${(e as Error).message}`))
  }

  /** GenQueue 上报"严重错误"（由 ErrorPolicy.classify() 判定） */
  reportFatal(err: Error): void {
    if (this.failed) return
    if (this.errorPolicy.classify(err) === 'fatal') {
      this.fail(err.message)
    }
  }

  private async stopComponents(): Promise<void> {
    // 一个组件 stop 抛错不能让其余组件漏停：用 allSettled 串行兜底
    await this.director?.stop().catch((e) => this.deps.onLog(`⚠️ 导演停止异常: ${(e as Error).message}`))
    await this.queue?.stop().catch((e) => this.deps.onLog(`⚠️ 队列停止异常: ${(e as Error).message}`))
    await this.deps.pusher.stop().catch((e) => this.deps.onLog(`⚠️ 推流停止异常: ${(e as Error).message}`))
  }

  addBeatView(beat: Beat): void {
    const view: BeatView = {
      id: beat.id,
      summary: beat.summary,
      shots: beat.shots.map((s) => ({
        id: s.id,
        beatId: s.beatId,
        prompt: s.prompt,
        duration: s.duration,
        status: 'queued' as ShotStatus,
      })),
    }
    this.beatViews.push(view)
    this.shotIndex = buildShotIndex(this.beatViews.map((bv) => bv.shots))
  }

  setShotStatus(shotId: string, status: ShotStatus): void {
    const ref = this.shotIndex.get(shotId)
    if (!ref) return
    this.beatViews[ref.beatIdx].shots[ref.shotIdx].status = status
  }

  addClipView(clip: { id: string; shotId: string; path: string; duration: number; readyAt: number }): ClipView {
    const view: ClipView = {
      id: clip.id,
      shotId: clip.shotId,
      url: `/clips/${path.basename(clip.path)}`,
      duration: clip.duration,
      readyAt: clip.readyAt,
    }
    this.clipViews.push(view)
    if (this.clipViews.length > 40) this.clipViews.shift()
    return view
  }

  /** 上游 Director 续写出新拍时调用 */
  onNewBeat(beat: Beat): void {
    this.lastBeatSummary = beat.summary
    // 同步追加到 storyState（让 Director 下次 tick 拿到最新拍表，避免 beat id 撞车）
    if (this.state) this.state.beats.push(beat)
    this.addBeatView(beat)
    // 入队续写产生的新镜头
    this.queue?.enqueue(beat.shots)
    this.deps.bus.emit('beat', { summary: beat.summary, shots: beat.shots.length })
  }

  /** 视频生成成功时调用，重置失败计数 */
  onClipProduced(): void {
    this.consecutiveFails = 0
    this.lastFailureAt = 0
  }

  /** 视频生成失败时调用 */
  onShotFailed(err: Error): void {
    const now = Date.now()
    if (now - this.lastFailureAt > 60_000) {
      this.consecutiveFails = 0
    }
    this.lastFailureAt = now
    this.consecutiveFails++
    if (this.consecutiveFails >= 6) {
      this.fail(`视频连续生成失败 ${this.consecutiveFails} 次（最近错误：${err.message}），已停止流水线，避免继续消耗。`)
      return
    }
    this.deps.bus.emit('error', err.message)
  }

  recordLatency(ms: number): void {
    this.latencies.push(ms)
    if (this.latencies.length > 50) this.latencies.shift()
  }

  get errorPolicy(): ErrorPolicy {
    return this.deps.errorPolicy
  }

  get queueStats() {
    return {
      pendingCount: this.queue?.pendingCount ?? 0,
      running: this.queue?.running ?? 0,
      produced: this.queue?.produced ?? 0,
    }
  }

  /** 给 selftest 用：DirectorStrategy 调 tick 用 */
  get stateView(): StoryState | null {
    return this.state
  }

  set stateView(s: StoryState) {
    this.state = s
  }

  status(playout: { bufferedSec: number; readyCount: number; playedCount: number } | null): StreamStatus {
    return {
      roomId: this.roomId,
      phase: this.phase,
      hlsUrl: this.deps.cfg.hlsUrl,
      rtmpUrl: this.deps.cfg.rtmpUrl,
      mock: this.deps.mock,
      mode: this.mode,
      resolution: this.deps.cfg.resolution,
      bufferedSec: Math.round(playout?.bufferedSec ?? 0),
      readyClips: playout?.readyCount ?? 0,
      pendingShots: this.queueStats.pendingCount,
      runningTasks: this.queueStats.running,
      avgGenLatencyMs: this.latencies.length
        ? Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length)
        : null,
      clipsProduced: this.queueStats.produced,
      clipsPlayed: playout?.playedCount ?? 0,
      currentBeatSummary: this.lastBeatSummary,
      error: this.errorMsg,
      startedAt: this.startedAt,
      beats: this.beatViews,
      clips: this.clipViews.slice(-30),
    }
  }

  /** selftest 用：等待推进到指定状态 */
  async waitUntil(
    pred: (s: StreamStatus) => boolean,
    timeoutMs: number,
    playout: { bufferedSec: number; readyCount: number; playedCount: number } | null,
  ): Promise<StreamStatus> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const s = this.status(playout)
      if (pred(s)) return s
      await new Promise<void>((r) => setTimeout(r, 300))
    }
    return this.status(playout)
  }
}