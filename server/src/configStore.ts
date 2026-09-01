import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from '@h3/protocol/types'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CONFIG_PATH = path.join(root, 'server', 'data', 'config.json')

/** 缺省配置（与协议类型保持一致；MOCK 模式由环境变量 MOCK=1 决定，不入此处） */
export function defaultConfig(): AppConfig {
  return {
    apiKey: '',
    video: {
      resolution: '480P',
      duration: 5,
      model: 'MiniMax-H3-Max',
      characterLockPrompt: '',
      referenceImageFileId: '',
    },
    script: {
      model: 'MiniMax-M3',
      maxBeats: 4,
      shotsPerBeat: 2,
      injectDanmaku: true,
      temperature: 0.7,
      thinking: false,
    },
    danmaku: {
      targetCount: 5,
      blacklist: [],
      minLength: 2,
      minIntervalMs: 800,
      douyinRoomId: '',
    },
  }
}

/** 读取持久化配置；文件不存在则返回默认值（且尝试落盘一次） */
export function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const def = defaultConfig()
      saveConfig(def)
      return def
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return mergeConfig(defaultConfig(), parsed)
  } catch {
    return defaultConfig()
  }
}

/** 浅合并：缺失字段用默认值填补（健壮性，避免磁盘上老文件缺字段崩） */
function mergeConfig(base: AppConfig, override: Partial<AppConfig>): AppConfig {
  return {
    apiKey: typeof override.apiKey === 'string' ? override.apiKey : base.apiKey,
    video: { ...base.video, ...(override.video ?? {}) },
    script: { ...base.script, ...(override.script ?? {}) },
    danmaku: { ...base.danmaku, ...(override.danmaku ?? {}) },
  }
}

/** 原子写：先写临时文件再 rename，避免半截文件 */
export function saveConfig(cfg: AppConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  const tmp = CONFIG_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_PATH)
}

/** 脱敏 apiKey（响应里只回 '***' 或 '***xxx' 末 4 位） */
export function maskApiKey(cfg: AppConfig): Omit<AppConfig, 'apiKey'> & { apiKey: string } {
  const { apiKey, ...rest } = cfg
  let masked = '***'
  if (apiKey && apiKey.length >= 4) masked = `***${apiKey.slice(-4)}`
  else if (apiKey) masked = '***'
  return { ...rest, apiKey: masked }
}
