import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 极简 .env 加载（无依赖），已存在的环境变量优先 */
export function loadEnvFile(filePath = path.join(root, '.env')): void {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

export const config = {
  root,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  mock: process.env.MOCK === '1',
  envApiKey: process.env.MINIMAX_API_KEY ?? '',
  cacheDir: process.env.CACHE_DIR ?? path.join(root, 'server', 'cache'),
  minimax: {
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com',
    textModel: process.env.TEXT_MODEL ?? 'MiniMax-M3',
    videoModel: process.env.VIDEO_MODEL ?? 'MiniMax-H3-Max',
    resolution: process.env.VIDEO_RESOLUTION ?? '480P',
  },
  gen: {
    concurrency: Number(process.env.GEN_CONCURRENCY ?? 2),
    clipDuration: Number(process.env.CLIP_DURATION ?? 5),
    targetBufferSec: Number(process.env.TARGET_BUFFER_SEC ?? 30),
    minBufferSec: Number(process.env.MIN_BUFFER_SEC ?? 15),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
    maxRetries: Number(process.env.MAX_RETRIES ?? 2),
  },
  srs: {
    rtmpBase: process.env.SRS_RTMP_URL ?? 'rtmp://127.0.0.1:1935/live',
    hlsBase: process.env.HLS_BASE ?? 'http://127.0.0.1:8080/live',
  },
  ffmpeg: process.env.FFMPEG ?? 'ffmpeg',
  ffprobe: process.env.FFPROBE ?? 'ffprobe',
  python: process.env.PYTHON ?? 'python3',
  mockCardScript: path.join(root, 'scripts', 'mock_card.py'),
} as const

export type AppConfig = typeof config
