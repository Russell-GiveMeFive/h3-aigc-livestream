import { config, loadEnvFile } from '../server/src/config'
import { MiniMaxClient } from '../server/src/providers/minimax'
import { MockTextProvider, MiniMaxTextProvider } from '../server/src/providers/text'
import { MockVideoProvider, MiniMaxVideoProvider } from '../server/src/providers/video'
import { MiniMaxFrameLinker, MockFrameLinker } from '../server/src/gen/frameLink'
import { LiveStream } from '../server/src/stream'
import { NullPusher } from '../server/src/playout/push'
import fs from 'node:fs'

/**
 * 无网络端到端自检（MOCK 模式）：
 * 剧本 → 拆分 → 生成（ffmpeg 测试片源 + 首帧续接）→ 播放池 → 按真实时间消耗。
 * 验证主环闭环可用，供 CI / 首次运行前快速体检。
 */
async function main(): Promise<void> {
  loadEnvFile()
  process.env.MOCK = '1'
  fs.mkdirSync(config.cacheDir, { recursive: true })

  const logs: string[] = []
  const log = (msg: string) => {
    logs.push(msg)
    console.log(`  ${msg}`)
  }

  const providers = {
    text: new MockTextProvider(),
    video: new MockVideoProvider({
      cacheDir: config.cacheDir,
      ffmpeg: config.ffmpeg,
      mockCardScript: config.mockCardScript,
      python: config.python,
      onLog: log,
    }),
    linker: new MockFrameLinker({ cacheDir: config.cacheDir, ffmpeg: config.ffmpeg }),
  }

  const bus = new (await import('node:events')).EventEmitter()
  const stream = new LiveStream({
    roomId: 'selftest',
    script: '测试剧本：主角在小镇发现神秘钥匙',
    mock: true,
    providers,
    textModelName: 'mock',
    bus,
    pushFactory: (engine) => new NullPusher(engine),
    cfg: {
      concurrency: 2,
      targetBufferSec: 15,
      maxAheadShots: 6,
      maxRetries: 1,
      rtmpUrl: 'rtmp://127.0.0.1:1935/live/selftest',
      hlsUrl: 'http://127.0.0.1:8080/live/selftest.m3u8',
      ffmpeg: config.ffmpeg,
      ffprobe: config.ffprobe,
      clipDuration: 5,
      resolution: '480P',
    },
    onLog: log,
  })

  console.log('▶ 启动流水线...')
  await stream.start()

  console.log('▶ 等待生成 ≥6 个镜头且推流 ≥3 个...')
  const status = await stream.waitUntil(
    (s) => s.clipsProduced >= 6 && s.clipsPlayed >= 3 && s.phase === 'running',
    90_000,
  )
  console.log('  状态:', JSON.stringify(status, null, 2))

  const frames = fs.readdirSync(config.cacheDir).filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
  const clips = fs.readdirSync(config.cacheDir).filter((f) => f.startsWith('mock_') && f.endsWith('.mp4'))

  const ok =
    status.clipsProduced >= 6 &&
    status.clipsPlayed >= 3 &&
    status.bufferedSec > 0 &&
    clips.length >= 6 &&
    frames.length >= 2

  await stream.stop()
  console.log(`\n结果: ${ok ? '✅ 自检通过' : '❌ 自检失败'}`)
  console.log(`  生成镜头 ${status.clipsProduced}（落盘 ${clips.length}） / 已推流 ${status.clipsPlayed} / 首帧图 ${frames.length} / 缓冲 ${status.bufferedSec}s`)
  if (!ok) {
    console.log('  日志尾部:')
    for (const l of logs.slice(-15)) console.log('   ', l)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('自检异常:', e)
  process.exit(1)
})
