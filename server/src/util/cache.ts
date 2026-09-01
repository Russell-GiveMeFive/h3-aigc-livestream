import fs from 'node:fs'
import path from 'node:path'

/**
 * cacheDir LRU 清理：按 mtime 降序保留最近 keep 个文件，多余的删除。
 * - 只扫顶层文件（不递归 history/ 之类的子目录，history 走自己的生命周期）
 * - 调用方负责时机：启动时 sweep 一次，或每次新写文件后 sweep（IO 频繁时仅启动期）
 *
 * Why: video provider 持续写 mp4/png，长期开播磁盘会被打爆；history 不在 cacheDir 不受影响。
 */
export function sweepCacheDir(cacheDir: string, keep = 200): { kept: number; deleted: number } {
  if (!fs.existsSync(cacheDir)) return { kept: 0, deleted: 0 }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(cacheDir, { withFileTypes: true })
  } catch {
    return { kept: 0, deleted: 0 }
  }

  const files = entries
    .filter((e) => e.isFile())
    .map((e) => {
      const p = path.join(cacheDir, e.name)
      try {
        const st = fs.statSync(p)
        return { path: p, mtime: st.mtimeMs }
      } catch {
        return null
      }
    })
    .filter((x): x is { path: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime)

  if (files.length <= keep) return { kept: files.length, deleted: 0 }
  const toDelete = files.slice(keep)
  let deleted = 0
  for (const f of toDelete) {
    try {
      fs.unlinkSync(f.path)
      deleted++
    } catch {
      /* 文件可能已被其他进程删，吞掉 */
    }
  }
  return { kept: keep, deleted }
}