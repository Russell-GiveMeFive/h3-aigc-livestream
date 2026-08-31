import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { ApiError, MiniMaxClient } from './minimax'
import { Shot } from '../types'
import { sleep } from '../util'

const execFileAsync = promisify(execFile)

export interface VideoGenOptions {
  /** 首帧引用：mm_file://{file_id}（真实模式）或本地 png 路径（mock 模式），实现"首帧续接" */
  firstFrame?: string
}

export interface VideoGenResult {
  localPath: string
  duration: number
}

export interface VideoProvider {
  readonly name: string
  generate(shot: Shot, opts: VideoGenOptions): Promise<VideoGenResult>
}

interface VideoTaskResp {
  task?: {
    id?: string
    status?: string
    duration?: number
    content?: { url?: string }
    error?: string
  }
}

/**
 * MiniMax-H3 / H3-Max 异步视频任务：
 * POST /v2/video_generation 创建 → 轮询 GET /v2/query/video_generation/{task_id} → 成功立即下载落盘
 * （content.url 有时效，必须及时转存，播放永远用本地文件）
 */
export class MiniMaxVideoProvider implements VideoProvider {
  readonly name: string
  constructor(
    private client: MiniMaxClient,
    private opts: {
      model: string
      resolution: string
      cacheDir: string
      pollIntervalMs: number
      onLog?: (msg: string) => void
    },
  ) {
    this.name = opts.model
  }

  async generate(shot: Shot, opts: VideoGenOptions): Promise<VideoGenResult> {
    const duration = clampDuration(shot.duration)
    const content: Record<string, unknown>[] = [{ type: 'text', text: shot.prompt }]
    if (opts.firstFrame) {
      // 图生视频：上一镜头末帧作为本镜头首帧 → 画面无缝续接
      content.push({ type: 'image_url', image_url: { url: opts.firstFrame }, role: 'first_frame' })
    }

    const body = {
      model: this.opts.model,
      content,
      resolution: this.opts.resolution,
      duration,
      ratio: '16:9',
    }

    const created = await this.client.postJson<{ task_id: string }>('/v2/video_generation', body)
    const taskId = created.task_id
    this.opts.onLog?.(`🎬 视频任务已创建 #${taskId.slice(-6)} 镜头[${shot.id}]${opts.firstFrame ? ' (首帧续接)' : ''}`)

    const deadline = Date.now() + 10 * 60 * 1000
    let pollFailures = 0
    while (Date.now() < deadline) {
      await sleep(this.opts.pollIntervalMs)
      let resp: VideoTaskResp
      try {
        resp = await this.client.getJson<VideoTaskResp>(`/v2/query/video_generation/${taskId}`)
        pollFailures = 0
      } catch (e) {
        const err = e as Error
        const retryable = !(e instanceof ApiError) || [429, 500, 502, 503, 504, 529].includes(e.httpCode)
        if (!retryable) throw e
        pollFailures++
        this.opts.onLog?.(`⚠️ 查询视频任务暂时失败（第 ${pollFailures} 次）：${err.message}，继续等待原任务`)
        await sleep(Math.min(1000 * 2 ** Math.min(pollFailures, 4), 12000))
        continue
      }
      const task = resp.task
      if (!task) throw new ApiError(500, 'video_task_invalid', `任务查询响应异常: ${JSON.stringify(resp)}`)
      if (task.status === 'succeeded') {
        if (!task.content?.url) throw new ApiError(500, 'video_task_no_url', '任务成功但缺少产物 URL')
        const localPath = path.join(this.opts.cacheDir, `${taskId}.mp4`)
        await this.client.download(task.content.url, localPath)
        this.opts.onLog?.(`✅ 视频完成 #${taskId.slice(-6)} 时长${task.duration ?? ''}s`)
        return { localPath, duration: Number(task.duration ?? duration) }
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        throw new ApiError(500, `video_task_${task.status}`, `视频任务${task.status}: ${task.error ?? ''}`)
      }
      // queued / running → 继续轮询
    }
    throw new ApiError(504, 'video_task_timeout', `视频生成超时（镜头 ${shot.id}）`)
  }
}

/**
 * Mock 视频 Provider：用 PIL 生成"AI 场景卡片"（深色渐变 + 镜头号 + 剧情描述 + 时间码动画），
 * ffmpeg 编码，模拟异步生成耗时（约 0.25x 实时）。无 Key 即可端到端验证流水线，
 * 且画面可读，能直观看到每个镜头在生成什么。
 */
export class MockVideoProvider implements VideoProvider {
  readonly name = 'Mock'
  constructor(
    private opts: {
      cacheDir: string
      ffmpeg: string
      mockCardScript: string
      python: string
      onLog?: (msg: string) => void
    },
  ) {}

  async generate(shot: Shot, opts: VideoGenOptions): Promise<VideoGenResult> {
    const duration = Math.min(Math.max(shot.duration || 5, 2), 8)
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const out = path.join(this.opts.cacheDir, `mock_${stamp}_${shot.id.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`)
    // 不同镜头不同强调色（按 id 哈希），便于肉眼验证顺序与首帧续接
    const hue = (parseInt(shot.id.slice(-2), 36) || 120) % 360
    const accent = hslToRgb(hue / 360, 0.8, 0.65)
      .map((v) => Math.round(v))
      .join(',')
    this.opts.onLog?.(`🎬 [mock] 生成镜头 ${shot.id} (${duration}s)${opts.firstFrame ? '，首帧续接已就绪' : ''}`)
    await sleep(duration * 250) // 模拟生成耗时
    await execFileAsync(this.opts.python, [
      this.opts.mockCardScript,
      '--out', out,
      '--label', `Shot ${shot.id}`,
      '--sub', shot.prompt.slice(0, 120),
      '--accent', accent,
      '--duration', String(duration),
    ])
    return { localPath: out, duration }
  }
}

/** HSL → RGB（0-255 数组），供 mock 强调色使用 */
function hslToRgb(h: number, s: number, l: number): number[] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  let rgb: number[]
  if (h < 1 / 6) rgb = [c, x, 0]
  else if (h < 2 / 6) rgb = [x, c, 0]
  else if (h < 3 / 6) rgb = [0, c, x]
  else if (h < 4 / 6) rgb = [0, x, c]
  else if (h < 5 / 6) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map((v) => (v + m) * 255)
}

export function clampDuration(d?: number): number {
  // H3-Max 支持 5~15s（H3 支持 4~15s），统一取 5~15
  return Math.min(Math.max(Math.round(d || 5), 5), 15)
}
