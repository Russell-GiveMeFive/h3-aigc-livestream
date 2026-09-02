import express from 'express'
import path from 'node:path'
import fs from 'node:fs'

export interface StaticDeps {
  cacheDir: string
  webDist: string
}

/** /clips/* 直链 + SPA fallback */
export function staticRoutes(deps: StaticDeps): express.Router {
  const r = express.Router()

  // 生成的视频片段（主播端回看；sendFile 自带 Range 支持）
  r.get('/clips/:file', (req, res) => {
    const file = path.basename(String(req.params.file ?? ''))
    if (!file || !/^[\w.-]+$/.test(file)) return res.status(400).json({ error: 'bad file name' })
    const full = path.join(deps.cacheDir, file)
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' })
    res.setHeader('Content-Type', 'video/mp4')
    res.sendFile(full)
  })

  // 生产模式：托管 web 构建产物（SPA，非 /api /ws /clips 路径回退到 index.html）
  if (fs.existsSync(deps.webDist)) {
    r.use(express.static(deps.webDist))
    r.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/clips')) {
        return next()
      }
      res.sendFile(path.join(deps.webDist, 'index.html'))
    })
  }

  return r
}