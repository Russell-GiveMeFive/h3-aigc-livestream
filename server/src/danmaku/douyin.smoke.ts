/**
 * Smoke test: 验证 DouyinSource 能从给定 webRid 拉到真实弹幕。
 * 用法: tsx server/src/danmaku/douyin.smoke.ts [webRid] [count]
 *
 * 默认 webRid = 10776146386（用户的直播间）
 */
import { createDouyinSource } from './douyin'
import type { DanmakuItem } from '@h3/protocol/types'

async function main() {
  const webRid = process.argv[2] ?? '10776146386'
  const targetCount = Number(process.argv[3] ?? 3)
  console.log(`[smoke] DouyinSource target=${webRid}, count=${targetCount}`)
  const items: DanmakuItem[] = []
  const source = createDouyinSource({ debug: true })
  const sub = await source.subscribe({
    roomId: webRid,
    onItem: (item) => {
      console.log(`[douyin] ${item.user}: ${item.text}`)
      items.push(item)
    },
  })
  // wait up to 20s
  const deadline = Date.now() + 20_000
  while (items.length < targetCount && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
  await sub.stop()
  console.log(`[smoke] collected ${items.length} items`)
  if (items.length === 0) {
    console.error('[smoke] FAIL: no danmaku collected')
    process.exit(1)
  }
  console.log('[smoke] OK')
}
main()
