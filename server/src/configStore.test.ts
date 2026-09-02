import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import {
  CONFIG_PATH,
  defaultConfig,
  loadConfig,
  maskApiKey,
  isMaskedApiKey,
  saveConfig,
} from './configStore'
import type { AppConfig } from '@h3/protocol/types'

const sample: AppConfig = {
  ...defaultConfig(),
  apiKey: 'sk-real-key-1234',
}

describe('configStore saveConfig mask-兜底', () => {
  let backup: string | null = null

  beforeEach(() => {
    if (fs.existsSync(CONFIG_PATH)) {
      backup = fs.readFileSync(CONFIG_PATH, 'utf8')
    }
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH)
  })

  afterEach(() => {
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH)
    if (backup !== null) {
      fs.writeFileSync(CONFIG_PATH, backup, 'utf8')
      backup = null
    }
  })

  it('新 key → 落盘是真 key', () => {
    saveConfig(sample)
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig
    expect(raw.apiKey).toBe('sk-real-key-1234')
  })

  it('传 ***xxx → 保留磁盘旧 key', () => {
    saveConfig(sample) // 第一次落真 key
    saveConfig({ ...sample, apiKey: '***1234' }) // 前端 GET 拿到脱敏占位回传
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig
    expect(raw.apiKey).toBe('sk-real-key-1234') // 没被覆盖
  })

  it('传 *** → 保留磁盘旧 key', () => {
    saveConfig(sample)
    saveConfig({ ...sample, apiKey: '***' }) // 短脱敏占位
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig
    expect(raw.apiKey).toBe('sk-real-key-1234')
  })

  it('传空串 → 保留磁盘旧 key（前端约定）', () => {
    saveConfig(sample)
    saveConfig({ ...sample, apiKey: '' }) // ConfigTab "用户没填新 key" 信号
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig
    expect(raw.apiKey).toBe('sk-real-key-1234')
  })

  it('磁盘无文件 + 传 ***xxx → 落盘 apiKey 为空', () => {
    // 不调用首次 saveConfig；磁盘无文件
    saveConfig({ ...sample, apiKey: '***abcd' })
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig
    expect(raw.apiKey).toBe('') // existing 解析为 null → preserved = ''
  })

  it('磁盘无文件 + 传新 key → 落盘是新 key', () => {
    saveConfig({ ...sample, apiKey: 'sk-fresh-9999' })
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig
    expect(raw.apiKey).toBe('sk-fresh-9999')
  })

  it('非 apiKey 字段正常落盘', () => {
    saveConfig({ ...sample, video: { ...sample.video, resolution: '768P' } })
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig
    expect(raw.video.resolution).toBe('768P')
    expect(raw.apiKey).toBe('sk-real-key-1234')
  })
})

describe('configStore 辅助函数', () => {
  it('isMaskedApiKey 识别 *** 前缀', () => {
    expect(isMaskedApiKey('***')).toBe(true)
    expect(isMaskedApiKey('***1234')).toBe(true)
    expect(isMaskedApiKey('sk-real')).toBe(false)
    expect(isMaskedApiKey('')).toBe(false)
  })

  it('maskApiKey 真 key → ***末4位', () => {
    const m = maskApiKey({ ...sample, apiKey: 'sk-real-key-1234' })
    expect(m.apiKey).toBe('***1234')
  })

  it('maskApiKey 空 key → ***', () => {
    const m = maskApiKey({ ...sample, apiKey: '' })
    expect(m.apiKey).toBe('***')
  })

  it('loadConfig 文件不存在 → 返回默认值（且落盘一次）', () => {
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH)
    const cfg = loadConfig()
    expect(cfg.apiKey).toBe('')
    expect(fs.existsSync(CONFIG_PATH)).toBe(true)
    fs.unlinkSync(CONFIG_PATH) // 清理
  })
})