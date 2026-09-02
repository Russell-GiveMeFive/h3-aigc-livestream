import fs from 'node:fs'
import path from 'node:path'
import type { HistoryEntry, HistoryClip, DanmakuItem, DraftBeat } from '@h3/protocol/types'

/** 历史索引条目（不带 detail 字段） */
export interface HistoryIndexItem {
  id: string
  roomId: string
  title: string
  createdAt: number
  clipCount: number
}

/**
 * 历史持久化：每个 entry 一个目录，detail 拆成 4 个文件。
 * 写入用 temp+rename 保证原子性。
 */
export class HistoryStore {
  private readonly root: string
  private readonly indexFile: string

  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'history')
    this.indexFile = path.join(this.root, 'index.json')
    fs.mkdirSync(this.root, { recursive: true })
  }

  /** 读取索引；不存在则返回空数组 */
  list(): HistoryIndexItem[] {
    if (!fs.existsSync(this.indexFile)) return []
    try {
      const raw = fs.readFileSync(this.indexFile, 'utf8')
      const arr = JSON.parse(raw) as HistoryIndexItem[]
      if (!Array.isArray(arr)) return []
      return arr
    } catch {
      return []
    }
  }

  /** 组装完整 entry；任意文件缺失返回 null */
  get(id: string): HistoryEntry | null {
    const dir = path.join(this.root, id)
    const meta = path.join(dir, 'meta.json')
    if (!fs.existsSync(meta)) return null

    let metaParsed: { id: string; roomId: string; title: string; createdAt: number }
    try {
      metaParsed = JSON.parse(fs.readFileSync(meta, 'utf8'))
    } catch {
      return null
    }

    const readArr = <T>(file: string, fallback: T[]): T[] => {
      if (!fs.existsSync(file)) return fallback
      try {
        const v = JSON.parse(fs.readFileSync(file, 'utf8'))
        return Array.isArray(v) ? (v as T[]) : fallback
      } catch {
        return fallback
      }
    }

    const danmakuUsed = readArr<DanmakuItem>(path.join(dir, 'danmakuUsed.json'), [])
    const beats = readArr<DraftBeat>(path.join(dir, 'beats.json'), [])
    const clips = readArr<HistoryClip>(path.join(dir, 'clips.json'), [])

    return {
      id: metaParsed.id,
      roomId: metaParsed.roomId,
      title: metaParsed.title,
      createdAt: metaParsed.createdAt,
      danmakuUsed,
      beats,
      clips,
    }
  }

  /** 写入一个完整 entry（meta + 3 detail 文件 + index 更新） */
  record(entry: HistoryEntry): void {
    const dir = path.join(this.root, entry.id)
    fs.mkdirSync(dir, { recursive: true })

    const meta = {
      id: entry.id,
      roomId: entry.roomId,
      title: entry.title,
      createdAt: entry.createdAt,
    }

    this.writeJsonAtomic(path.join(dir, 'meta.json'), meta)
    this.writeJsonAtomic(path.join(dir, 'danmakuUsed.json'), entry.danmakuUsed ?? [])
    this.writeJsonAtomic(path.join(dir, 'beats.json'), entry.beats ?? [])
    this.writeJsonAtomic(path.join(dir, 'clips.json'), entry.clips ?? [])

    // 更新 index
    const idx = this.list().filter((it) => it.id !== entry.id)
    idx.unshift({
      id: entry.id,
      roomId: entry.roomId,
      title: entry.title,
      createdAt: entry.createdAt,
      clipCount: (entry.clips ?? []).length,
    })
    this.writeJsonAtomic(this.indexFile, idx)
  }

  /**
   * 解析 clipId → 磁盘文件路径。
   * HistoryClip.url 形如 "/clips/<file>"（由 static.ts 暴露），
   * 我们从 url 末尾取文件名，落到 cacheDir 根下（与 provider 写盘路径一致）。
   * 若解析失败，返回 null。
   */
  serveClip(id: string, clipId: string, cacheDir: string): { path: string; contentType: string } | null {
    const entry = this.get(id)
    if (!entry) return null
    const clip = entry.clips.find((c) => c.id === clipId)
    if (!clip) return null
    // 优先从 url 末尾取文件名（"/clips/foo.mp4" → "foo.mp4"）
    let file = ''
    try {
      const u = new URL(clip.url, 'http://placeholder')
      const parts = u.pathname.split('/').filter(Boolean)
      file = parts[parts.length - 1] ?? ''
    } catch {
      file = path.basename(clip.url)
    }
    if (!file) return null

    // 与 server/src/http/routes/static.ts:18 和 providers/video.ts:83,117 一致：直读 cacheDir 根
    const full = path.join(cacheDir, file)
    if (!fs.existsSync(full)) return null

    const ext = path.extname(full).toLowerCase()
    const contentType = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4'
    return { path: full, contentType }
  }

  /** temp + rename 原子写 */
  private writeJsonAtomic(target: string, value: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  }
}
