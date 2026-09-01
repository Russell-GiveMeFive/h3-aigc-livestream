import express from 'express'
import type { AppConfig, ConfigResp } from '@h3/protocol/types'
import { defaultConfig, loadConfig, maskApiKey, saveConfig } from '../../configStore'

/** GET /api/config、POST /api/config —— 设置页 REST */
export function settingsRoutes(): express.Router {
  const r = express.Router()

  r.get('/config', (_req, res) => {
    const cfg = loadConfig()
    const resp: ConfigResp = { config: maskApiKey(cfg), defaults: defaultConfig() }
    res.json(resp)
  })

  r.post('/config', (req, res) => {
    const err = validateConfig(req.body)
    if (err) return res.status(400).json({ error: err })
    const cfg = req.body as AppConfig
    saveConfig(cfg)
    const resp: ConfigResp = { config: maskApiKey(cfg), defaults: defaultConfig() }
    res.json(resp)
  })

  return r
}

/** 校验入参（容错式：字段缺失给默认值；类型/范围不合规直接 400） */
function validateConfig(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return '请求体必须是对象'
  const cfg = raw as Partial<AppConfig>

  if (typeof cfg.apiKey !== 'string') return 'apiKey 必须为字符串'

  if (!cfg.video || typeof cfg.video !== 'object') return 'video 字段缺失'
  const v = cfg.video
  if (v.resolution !== '480P' && v.resolution !== '768P') return 'video.resolution 必须为 480P 或 768P'
  if (typeof v.duration !== 'number' || v.duration <= 0 || v.duration > 60) return 'video.duration 必须在 1..60 之间'
  if (typeof v.model !== 'string' || !v.model.trim()) return 'video.model 不能为空'
  if (v.seed !== undefined && typeof v.seed !== 'number') return 'video.seed 必须为数字'
  if (v.characterLockPrompt !== undefined && typeof v.characterLockPrompt !== 'string') return 'video.characterLockPrompt 必须为字符串'
  if (v.referenceImageFileId !== undefined && typeof v.referenceImageFileId !== 'string') return 'video.referenceImageFileId 必须为字符串'

  if (!cfg.script || typeof cfg.script !== 'object') return 'script 字段缺失'
  const s = cfg.script
  if (typeof s.model !== 'string' || !s.model.trim()) return 'script.model 不能为空'
  if (typeof s.maxBeats !== 'number' || s.maxBeats < 1 || s.maxBeats > 20) return 'script.maxBeats 必须在 1..20 之间'
  if (typeof s.shotsPerBeat !== 'number' || s.shotsPerBeat < 1 || s.shotsPerBeat > 10) return 'script.shotsPerBeat 必须在 1..10 之间'
  if (typeof s.injectDanmaku !== 'boolean') return 'script.injectDanmaku 必须为布尔值'
  if (s.temperature !== undefined && (typeof s.temperature !== 'number' || s.temperature < 0 || s.temperature > 2)) {
    return 'script.temperature 必须在 0..2 之间'
  }
  if (s.thinking !== undefined && typeof s.thinking !== 'boolean') return 'script.thinking 必须为布尔值'

  if (!cfg.danmaku || typeof cfg.danmaku !== 'object') return 'danmaku 字段缺失'
  const d = cfg.danmaku
  if (typeof d.targetCount !== 'number' || d.targetCount < 0 || d.targetCount > 10) return 'danmaku.targetCount 必须在 0..10 之间'
  if (!Array.isArray(d.blacklist) || d.blacklist.some((x) => typeof x !== 'string')) return 'danmaku.blacklist 必须为字符串数组'
  if (typeof d.minLength !== 'number' || d.minLength < 1 || d.minLength > 50) return 'danmaku.minLength 必须在 1..50 之间'
  if (typeof d.minIntervalMs !== 'number' || d.minIntervalMs < 0 || d.minIntervalMs > 60000) return 'danmaku.minIntervalMs 必须在 0..60000 之间'
  if (d.douyinRoomId !== undefined && typeof d.douyinRoomId !== 'string') return 'danmaku.douyinRoomId 必须为字符串'

  return null
}
