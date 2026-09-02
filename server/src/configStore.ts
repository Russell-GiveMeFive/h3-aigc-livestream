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

/** 脱敏占位前缀：与 maskApiKey 输出对齐，服务端识别"前端没填/回传了 GET 响应" */
export const MASK_PREFIX = '***'

/** 是否是 maskApiKey 输出的占位（'***' / '***xxx'）；saveConfig 用作"保留磁盘旧 key"的信号 */
export function isMaskedApiKey(apiKey: string): boolean {
  return typeof apiKey === 'string' && apiKey.startsWith(MASK_PREFIX)
}

/** 读磁盘已有 cfg（用于 saveConfig 兜底保留 apiKey） */
function readExistingConfig(): AppConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(raw) as AppConfig
  } catch {
    return null
  }
}

/** 原子写：先写临时文件再 rename，避免半截文件
 *  兜底：若入参 apiKey 是脱敏占位（'***' / '***xxx'）或空串，按"前端没填新 key"处理，
 *  保留磁盘上已有真 key。前端 ConfigTab / SettingsPage 的 `***` 语义与此约定对齐。
 *  注意：**不能**借空串来清 key —— 显式清 key 需单独 endpoint，不在 saveConfig 范围。 */
export function saveConfig(cfg: AppConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })

  let toWrite: AppConfig = cfg
  if (isMaskedApiKey(cfg.apiKey) || cfg.apiKey === '') {
    const existing = readExistingConfig()
    const preserved = existing?.apiKey ?? ''
    toWrite = { ...cfg, apiKey: preserved }
  }

  const tmp = CONFIG_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_PATH)
}

/** 脱敏 apiKey（响应里只回 '***' 或 '***xxx' 末 4 位） */
export function maskApiKey(cfg: AppConfig): Omit<AppConfig, 'apiKey'> & { apiKey: string } {
  const { apiKey, ...rest } = cfg
  let masked = MASK_PREFIX
  if (apiKey && apiKey.length >= 4) masked = `${MASK_PREFIX}${apiKey.slice(-4)}`
  else if (apiKey) masked = MASK_PREFIX
  return { ...rest, apiKey: masked }
}
