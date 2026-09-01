import fs from 'node:fs'
import { config, loadEnvFile } from './config'
import { createApp } from './app'
import { sweepCacheDir } from './util/cache'

loadEnvFile()
fs.mkdirSync(config.cacheDir, { recursive: true })

// 启动时 LRU 清理 cacheDir：保留最近 200 个文件。长期开播避免磁盘打爆。
const sweep = sweepCacheDir(config.cacheDir, 200)
if (sweep.deleted > 0) console.log(`[startup] cacheDir sweep: kept=${sweep.kept} deleted=${sweep.deleted}`)

const { server } = createApp({ config })

server.listen(config.port, config.host, () => {
  const lines = [
    `── 实时 AIGC 直播服务已启动 ──`,
    `  主播入口: http://${config.host}:${config.port}/streamer`,
    `  观众入口: http://${config.host}:${config.port}/viewer?room=<room>`,
    `  模式: ${config.mock ? 'MOCK（无 Key 全链路演示）' : '真实 MiniMax API'}`,
    `  文本模型: ${config.minimax.textModel} / 视频模型: ${config.minimax.videoModel} ${config.minimax.resolution}`,
    `  推流: ${config.srs.rtmpBase}/<room>  →  HLS: ${config.srs.hlsBase}/<room>.m3u8`,
    `  缓存目录: ${config.cacheDir}`,
    ``,
  ]
  console.log(lines.join('\n'))
})