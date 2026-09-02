/**
 * Smoke test: 验证 Node 端能从 live.douyin.com 抠到真实 roomId。
 * 用法: tsx server/src/danmaku/roomInfo.smoke.ts [webRid]
 *
 * 默认 webRid = 10776146386（用户的直播间）
 */
import { resolveRoomInfo } from './roomInfo'

async function main() {
  const webRid = process.argv[2] ?? '10776146386'
  console.log(`[smoke] resolving ${webRid}...`)
  try {
    const r = await resolveRoomInfo(webRid)
    console.log('[smoke] OK:', r)
  } catch (err) {
    console.error('[smoke] FAIL:', (err as Error).message)
    process.exit(1)
  }
}

main()
