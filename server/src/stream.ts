import { EventEmitter } from 'node:events'
import path from 'node:path'
import { Director } from './story/director'
import { continueStory } from './story/continuer'
import { splitScript } from './story/splitter'
import { GenQueue } from './gen/queue'
import { FrameLinker } from './gen/frameLink'
import { ApiError } from './providers/minimax'
import { TextProvider } from './providers/text'
import { VideoProvider } from './providers/video'
import { PlayoutEngine } from './playout/engine'
import { Pusher } from './playout/push'
import { Beat, BeatView, Clip, ClipView, ContinueMode, ShotStatus, StoryState, StreamPhase, StreamStatus } from './types'
import { nowId, sleep } from './util'

export interface StreamProviders {
  text: TextProvider
  video: VideoProvider
  linker: FrameLinker | null
}

export interface StreamOptions {
  roomId: string
  script: string
  mock: boolean
  providers: StreamProviders
  textModelName: string
  bus: EventEmitter
  pushFactory: (engine: PlayoutEngine) => Pusher
  cfg: {
    concurrency: number
    targetBufferSec: number
    maxAheadShots: number
    maxRetries: number
    rtmpUrl: string
    hlsUrl: string
    ffmpeg: string
    ffprobe: string
    clipDuration: number
    resolution: '480P' | '768P'
  }
  onLog: (msg: string) => void
}

/**
 * 一条直播流的组合根：剧本 → 分镜 → 生成队列（首帧续接）→ 播放池 → 推流，
 * 导演引擎维持缓冲水位持续续写。M1 续写模式固定为 ai。
 */
export class LiveStream {
  readonly roomId: string
  readonly sessionId: string
  private state: StoryState | null = null
  private queue!: GenQueue
  private playout!: PlayoutEngine
  private pusher!: Pusher
  private director: Director | null = null
  private phase: StreamPhase = 'idle'
  private errorMsg: string | undefined
  private readonly mode: ContinueMode = 'ai'
  private readonly startedAt = Date.now()
  private lastBeatSummary: string | null = null
  private readonly latencies: number[] = []
  private runToken: string | null = null
  private failed = false
  private consecutiveFails = 0
  private beatViews: BeatView[] = []
  private clipViews: ClipView[] = []
  private shotIndex = new Map<string, { beatIdx: number; shotIdx: number }>()

  constructor(private opts: StreamOptions) {
    this.roomId = opts.roomId
    this.sessionId = nowId('sess')
  }

  get phaseValue(): StreamPhase {
    return this.phase
  }

  async start(): Promise<void> {
    const token = nowId('run')
    this.runToken = token
    this.phase = 'splitting'
    this.opts.onLog('📖 正在用文本模型拆分剧本...')

    try {
      const plan = await splitScript(this.opts.providers.text, this.opts.script)
      this.opts.onLog(
        `📖 剧本拆分完成:《${plan.title}》 ${plan.beats.length} 拍 / ${plan.beats.reduce((n, b) => n + b.shots.length, 0)} 镜头，角色 ${plan.characters.length} 个`,
      )
      if (this.runToken !== token) return // 已被 stop 打断

      this.state = {
        title: plan.title,
        premise: this.opts.script,
        world: plan.world,
        characters: plan.characters,
        entities: plan.entities,
        beats: plan.beats,
      }

      this.playout = new PlayoutEngine()
      this.pusher = this.opts.pushFactory(this.playout)

      this.queue = new GenQueue(
        this.opts.providers.video,
        this.opts.providers.linker ?? undefined,
        {
          onShotStart: (shotId: string) => this.setShotStatus(shotId, 'running'),
          onClipReady: (clip: Clip) => {
            this.consecutiveFails = 0
            this.playout.addClip(clip)
            this.setShotStatus(clip.shotId, 'ready')
            const view: ClipView = {
              id: clip.id,
              shotId: clip.shotId,
              url: `/clips/${path.basename(clip.path)}`,
              duration: clip.duration,
              readyAt: clip.readyAt,
            }
            this.clipViews.push(view)
            if (this.clipViews.length > 40) this.clipViews.shift()
            this.opts.bus.emit('clip', { id: clip.id, shotId: clip.shotId, duration: clip.duration, url: view.url })
          },
          onLog: (msg) => this.opts.onLog(msg),
          onShotFailed: (_shotId, err) => {
            this.setShotStatus(_shotId, 'failed')
            // 402 余额不足：永久性故障，立即停止并给出可操作提示
            if (err instanceof ApiError && err.httpCode === 402) {
              this.fail('视频生成失败：账户余额不足（MiniMax H3/H3-Max 为按量付费）。请到 platform.minimaxi.com 充值后重新开播。')
              return
            }
            this.consecutiveFails++
            if (this.consecutiveFails >= 6) {
              this.fail(`视频连续生成失败 ${this.consecutiveFails} 次（最近错误：${err.message}），已停止流水线，避免继续消耗。`)
              return
            }
            this.setShotStatus(_shotId, 'failed')
            this.opts.bus.emit('error', err.message)
          },
          onLatency: (ms) => {
            this.latencies.push(ms)
            if (this.latencies.length > 50) this.latencies.shift()
          },
        },
        {
          concurrency: this.opts.cfg.concurrency,
          maxRetries: this.opts.cfg.maxRetries,
          rewritePrompt: async (prompt) => {
            const raw = await this.opts.providers.text.complete({
              system: '你负责把可能含敏感内容的视频提示词改写成合规版本，保持镜头意图。只输出改写后的提示词本身。',
              messages: [{ role: 'user', content: prompt }],
              thinking: false,
              maxTokens: 1024,
            })
            return raw.trim() || prompt
          },
        },
      )

      this.director = new Director(
        this.state,
        this.opts.providers.text,
        this.queue,
        this.playout,
        {
          targetBufferSec: this.opts.cfg.targetBufferSec,
          maxAheadShots: this.opts.cfg.maxAheadShots,
          onBeat: (beat: Beat) => {
            this.lastBeatSummary = beat.summary
            this.addBeatView(beat)
            this.opts.bus.emit('beat', { summary: beat.summary, shots: beat.shots.length })
          },
          onLog: (msg) => this.opts.onLog(msg),
        },
      )

      // 先把剧本自带的拍全部入队，再启动导演续写循环与推流
      for (const beat of plan.beats) {
        this.addBeatView(beat)
        for (const shot of beat.shots) this.queue.enqueue(shot)
      }
      this.opts.onLog(`🚀 已入队 ${plan.beats.reduce((n, b) => n + b.shots.length, 0)} 个镜头，启动续写与推流`)
      this.pusher.start()
      void this.director.start().catch((e) => {
        if (this.phase === 'running') this.fail(`导演循环异常：${(e as Error).message}`)
      })
      this.phase = 'running'
      this.opts.bus.emit('phase', 'running')
    } catch (e) {
      this.runToken = null
      this.phase = 'error'
      this.errorMsg = (e as Error).message
      this.opts.bus.emit('error', this.errorMsg)
      this.opts.bus.emit('phase', 'error')
      this.opts.onLog(`💥 直播启动失败: ${this.errorMsg}`)
      await this.stopComponents()
      throw e
    }
  }

  async stop(): Promise<void> {
    this.runToken = null
    this.phase = 'stopping'
    await this.stopComponents()
    this.phase = 'stopped'
    this.opts.bus.emit('phase', 'stopped')
    this.opts.onLog('🛑 直播已停止')
  }

  /** 硬故障（余额不足 / 连续失败）：停止流水线并保持 error 状态，向主播与观众广播明确原因 */
  private fail(msg: string): void {
    if (this.failed) return
    this.failed = true
    this.runToken = null
    this.errorMsg = msg
    this.phase = 'error'
    this.opts.onLog(`💥 ${msg}`)
    this.opts.bus.emit('error', msg)
    this.opts.bus.emit('phase', 'error')
    void this.stopComponents()
      .then(() => this.opts.onLog('🛑 流水线已停止（可修改配置后重新开播）'))
      .catch((e) => this.opts.onLog(`⚠️ 流水线清理异常: ${(e as Error).message}`))
  }

  private async stopComponents(): Promise<void> {
    await this.director?.stop()
    await this.queue?.stop()
    await this.pusher?.stop()
  }

  /** 追加一幕到剧本时间线，镜头初始为 queued */
  private addBeatView(beat: Beat): void {
    const view: BeatView = {
      id: beat.id,
      summary: beat.summary,
      shots: beat.shots.map((s) => ({
        id: s.id,
        beatId: s.beatId,
        prompt: s.prompt,
        duration: s.duration,
        status: 'queued',
      })),
    }
    const beatIdx = this.beatViews.length
    this.beatViews.push(view)
    view.shots.forEach((s, shotIdx) => this.shotIndex.set(s.id, { beatIdx, shotIdx }))
  }

  private setShotStatus(shotId: string, status: ShotStatus): void {
    const ref = this.shotIndex.get(shotId)
    if (!ref) return
    this.beatViews[ref.beatIdx].shots[ref.shotIdx].status = status
  }

  status(): StreamStatus {
    return {
      roomId: this.roomId,
      phase: this.phase,
      hlsUrl: this.opts.cfg.hlsUrl,
      rtmpUrl: this.opts.cfg.rtmpUrl,
      mock: this.opts.mock,
      mode: this.mode,
      resolution: this.opts.cfg.resolution,
      bufferedSec: Math.round(this.playout?.bufferedSec ?? 0),
      readyClips: this.playout?.readyCount ?? 0,
      pendingShots: this.queue?.pendingCount ?? 0,
      runningTasks: this.queue?.running ?? 0,
      avgGenLatencyMs: this.latencies.length
        ? Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length)
        : null,
      clipsProduced: this.queue?.produced ?? 0,
      clipsPlayed: this.playout?.playedCount ?? 0,
      currentBeatSummary: this.lastBeatSummary,
      error: this.errorMsg,
      startedAt: this.startedAt,
      beats: this.beatViews,
      clips: this.clipViews.slice(-30),
    }
  }

  /** 供 selftest 使用：等待推进到指定进度 */
  async waitUntil(pred: (s: StreamStatus) => boolean, timeoutMs: number): Promise<StreamStatus> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const s = this.status()
      if (pred(s)) return s
      await sleep(300)
    }
    return this.status()
  }
}
