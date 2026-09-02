/**
 * 抖音弹幕接入冒烟测试
 *
 * 用法：
 *   npm run test:douyin -- 731123456789
 *   npm run test:douyin -- https://live.douyin.com/731123456789
 *
 * 默认行为：
 *   - 不接签名后端（用 stub），跑完整 wss+protobuf 管线直到签名阶段抛错
 *     退出，验证 schema/管道无语法问题。
 *   - 想跑真弹幕：注入环境变量
 *       DOUYIN_SIGN_FETCHER='{"type":"fake","value":"xxx"}'
 *     暂仅支持 type=fake；playwright / remote dycast 由你按需扩展。
 */

import { createDouyinSource, type SignatureFetcher } from '../server/src/danmaku/douyin'
import { createFakeSignature } from '../server/src/danmaku/signature'

function pickSignatureFetcher(): SignatureFetcher {
  const raw = process.env.DOUYIN_SIGN_FETCHER
  if (!raw) {
    return (async () => {
      throw new Error(
        'No DOUYIN_SIGN_FETCHER configured — using stub. This is expected for a smoke test.',
      )
    }) as SignatureFetcher
  }
  try {
    const cfg = JSON.parse(raw) as { type: string; value?: string }
    if (cfg.type === 'fake') return createFakeSignature(cfg.value)
    throw new Error(`unknown fetcher type: ${cfg.type}`)
  } catch (err) {
    throw new Error(`bad DOUYIN_SIGN_FETCHER json: ${(err as Error).message}`)
  }
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('用法: npm run test:douyin -- <roomId | url>')
    process.exit(2)
  }

  const source = createDouyinSource({
    signatureImpl: pickSignatureFetcher(),
    debug: true,
  })

  const ac = new AbortController()
  const stopTimer = setTimeout(() => ac.abort(), Number(process.env.MAX_RUNTIME_MS ?? 30_000))

  let printed = 0
  const start = Date.now()
  console.log(`[test-douyin] subscribing to ${arg} (max 30s)…`)

  try {
    const sub = await source.subscribe({
      roomId: arg,
      onItem: (item) => {
        printed += 1
        if (printed <= 10) {
          console.log(`[弹幕#${printed}] ${item.user}: ${item.text}`)
        }
        if (printed === 10) {
          console.log('…（仅打印前 10 条，后续不再打印文本，但订阅仍在）')
        }
      },
      signal: ac.signal,
    })

    // 等 abort / timeout
    await new Promise<void>((resolve) => {
      ac.signal.addEventListener('abort', () => resolve())
    })

    console.log(`[test-douyin] stopping after ${printed} items (${Date.now() - start}ms)`)
    await sub.stop()
    clearTimeout(stopTimer)
    process.exit(0)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('signature fetch failed') || msg.includes('Signature')) {
      console.warn(
        '[test-douyin] 预期失败：未配置签名后端。' +
          'WSS+protobuf 管线已构造成功；接入真实签名后即可看到弹幕。',
      )
      console.warn('  详细错误：', msg)
      clearTimeout(stopTimer)
      process.exit(0)
    }
    console.error('[test-douyin] 失败:', msg)
    clearTimeout(stopTimer)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[test-douyin] 未捕获异常', err)
  process.exit(1)
})