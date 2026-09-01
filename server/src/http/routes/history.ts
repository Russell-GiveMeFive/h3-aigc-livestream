import express from 'express'
import path from 'node:path'
import { HistoryStore, type HistoryIndexItem } from '../../history'
import type { HistoryEntry } from '@h3/protocol/types'

export interface HistoryRouteDeps {
  /** 历史数据目录的父目录（store 内部会拼上 /history） */
  dataDir: string
  /** 生成的视频片段所在目录（用于 serveClip 解析 url） */
  cacheDir: string
}

/**
 * /api/history：列表 + 详情 + 视频片段直链。
 * 路由表按挂载点为 /api/history 写，路径里不再带前缀。
 */
export function historyRoutes(deps: HistoryRouteDeps): express.Router {
  const r = express.Router()
  const store = new HistoryStore(deps.dataDir)

  // GET /api/history → { entries: HistoryEntry[] }
  r.get('/', (_req, res) => {
    const items: HistoryIndexItem[] = store.list()
    // 同时组装完整 entry（detail 文件可能缺失，回退到空数组）
    const entries: HistoryEntry[] = items
      .map((it) => store.get(it.id))
      .filter((e): e is HistoryEntry => e !== null)
    res.json({ entries })
  })

  // GET /api/history/:id → 单条 HistoryEntry
  r.get('/:id', (req, res) => {
    const id = path.basename(String(req.params.id ?? ''))
    if (!id || !/^[\w.-]+$/.test(id)) return res.status(400).json({ error: 'bad id' })
    const entry = store.get(id)
    if (!entry) return res.status(404).json({ error: 'history entry not found' })
    res.json(entry)
  })

  // GET /api/history/:id/clips/:clipId → 视频文件流
  r.get('/:id/clips/:clipId', (req, res) => {
    const id = path.basename(String(req.params.id ?? ''))
    const clipId = path.basename(String(req.params.clipId ?? ''))
    if (!id || !clipId) return res.status(400).json({ error: 'bad params' })
    const served = store.serveClip(id, clipId, deps.cacheDir)
    if (!served) return res.status(404).json({ error: 'clip not found' })
    res.setHeader('Content-Type', served.contentType)
    res.sendFile(served.path)
  })

  return r
}
