import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { Clip } from '@h3/protocol/types'
import { sleep } from '../util'
import { PlayoutEngine } from './engine'
import type { Pusher } from '../interfaces/push'

const execFileAsync = promisify(execFile)

export type { Pusher }

export interface PusherOptions {
  ffmpeg: string
  ffprobe: string
  onLog?: (msg: string) => void
}

/**
 * RTMP 推流器：从播放池按序取片，ffmpeg `-re` 实时推给 SRS。
 * 每个镜头一个 ffmpeg 进程，镜头之间有小间隔（M1 已知限制）；
 * 后续可用"双推流重叠切换"（SRS 新推流顶替旧推流）或 fMP4 管道实现无缝衔接。
 * 无音轨的镜头自动补静音 AAC，保证 HLS 码流稳定。
 */
export class RtmpPusher implements Pusher {
  private current: { clip: Clip; child: ReturnType<typeof spawn> } | null = null
  private stopped = false
  private pushed = 0
  private loopPromise: Promise<void> | null = null

  constructor(
    private engine: PlayoutEngine,
    private rtmpUrl: string,
    private opts: PusherOptions,
  ) {}

  get currentClipId(): string | null {
    return this.current?.clip.id ?? null
  }

  get pushedCount(): number {
    return this.pushed
  }

  start(): void {
    this.loopPromise = this.loop()
  }

  async stop(): Promise<void> {
    this.stopped = true
    const proc = this.current?.child
    if (proc) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try { proc.kill('SIGKILL') } catch { /* noop */ }
        }, 1000)
        proc.once('exit', () => {
          clearTimeout(killTimer)
          this.current = null
          resolve()
        })
        try { proc.kill('SIGTERM') } catch { /* noop */ }
      })
    }
    await this.loopPromise?.catch(() => {})
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const clip = this.engine.takeNext()
        if (!clip) {
          this.opts.onLog?.('⏳ 播放池暂无就绪镜头，等待生成...')
          await sleep(500)
          continue
        }
        this.pushed++
        this.opts.onLog?.(`📤 推流镜头 ${clip.id} (${clip.duration}s) → ${this.rtmpUrl}`)
        await this.pushClip(clip)
      } catch (e) {
        if (!this.stopped) this.opts.onLog?.(`⚠️ 推流循环异常: ${(e as Error).message}`)
        await sleep(500)
      }
    }
  }

  private async pushClip(clip: Clip): Promise<void> {
    const hasAudio = await hasAudioTrack(clip.path, this.opts.ffprobe)
    const args: string[] = ['-y', '-re', '-i', clip.path]
    if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
    args.push(
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-f', 'flv',
      this.rtmpUrl,
    )
    const child = spawn(this.opts.ffmpeg, args, { stdio: ['ignore', 'ignore', 'ignore'] })
    this.current = { clip, child }
    await new Promise<void>((resolve) => {
      const done = () => {
        this.current = null
        resolve()
      }
      child.on('exit', (code) => {
        if (code !== 0 && !this.stopped) {
          this.opts.onLog?.(`⚠️ ffmpeg 推流退出码 ${code}`)
        }
        done()
      })
      child.on('error', () => done())
    })
  }
}

/** 推流目标为空/本地验证用：按真实时间消耗播放池（无网络） */
export class NullPusher implements Pusher {
  private currentClipIdValue: string | null = null
  private stopped = false
  private pushed = 0
  private loopPromise: Promise<void> | null = null

  constructor(private engine: PlayoutEngine) {}

  get currentClipId(): string | null {
    return this.currentClipIdValue
  }

  get pushedCount(): number {
    return this.pushed
  }

  start(): void {
    this.loopPromise = this.loop()
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.loopPromise?.catch(() => {})
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const clip = this.engine.takeNext()
      if (!clip) {
        await sleep(200)
        continue
      }
      this.currentClipIdValue = clip.id
      this.pushed++
      await sleep(clip.duration * 1000)
      this.currentClipIdValue = null
    }
  }
}

async function hasAudioTrack(videoPath: string, ffprobe: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      videoPath,
    ])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}
