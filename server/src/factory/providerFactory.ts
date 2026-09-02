import type { FrameLinker, TextProvider, VideoProvider } from '../interfaces/provider'
import type { ErrorPolicy } from '../interfaces/error'
import { MiniMaxClient } from '../providers/minimax'
import { MiniMaxTextProvider, MockTextProvider } from '../providers/text'
import { MiniMaxVideoProvider, MockVideoProvider } from '../providers/video'
import { MiniMaxFrameLinker, MockFrameLinker } from '../gen/frameLink'
import { ApiError } from '../providers/minimaxError'

/** Provider 工厂（Mock/真实模式二选一）：由 Session.mock 决定 */
export interface ProviderBundle {
  text: TextProvider
  video: VideoProvider
  linker: FrameLinker | null
}

export interface ProviderFactoryDeps {
  cacheDir: string
  ffmpeg: string
  mockCardScript: string
  python: string
  minimax: { baseUrl: string; textModel: string; videoModel: string; resolution: string }
  pollIntervalMs: number
  log: (msg: string) => void
}

export function makeProviders(apiKey: string, mock: boolean, deps: ProviderFactoryDeps): ProviderBundle {
  if (mock) {
    return {
      text: new MockTextProvider(),
      video: new MockVideoProvider({
        cacheDir: deps.cacheDir,
        ffmpeg: deps.ffmpeg,
        mockCardScript: deps.mockCardScript,
        python: deps.python,
        onLog: deps.log,
      }),
      linker: new MockFrameLinker({ cacheDir: deps.cacheDir, ffmpeg: deps.ffmpeg }),
    }
  }
  const client = new MiniMaxClient(apiKey, deps.minimax.baseUrl, deps.log)
  return {
    text: new MiniMaxTextProvider(client, deps.minimax.textModel),
    video: new MiniMaxVideoProvider(client, {
      model: deps.minimax.videoModel,
      resolution: deps.minimax.resolution,
      cacheDir: deps.cacheDir,
      pollIntervalMs: deps.pollIntervalMs,
      onLog: deps.log,
    }),
    linker: new MiniMaxFrameLinker(client, { cacheDir: deps.cacheDir, ffmpeg: deps.ffmpeg, onLog: deps.log }),
  }
}

/** 默认 ErrorPolicy：识别 ApiError 的 httpCode，按严重度分类 */
export function makeDefaultErrorPolicy(): ErrorPolicy {
  return {
    classify(err: unknown): 'fatal' | 'retryable' | 'swallow' {
      if (err instanceof ApiError) {
        // 余额不足：致命错误（导演应立即停机）
        if (err.httpCode === 402) return 'fatal'
        // 限流 / 服务端 / 超时：退避重试
        if (err.httpCode === 429 || err.httpCode === 500 || err.httpCode === 502 || err.httpCode === 503 || err.httpCode === 504 || err.httpCode === 529) {
          return 'retryable'
        }
        // 422 敏感内容（重写一次后放弃）
        return 'swallow'
      }
      return 'swallow'
    },
  }
}