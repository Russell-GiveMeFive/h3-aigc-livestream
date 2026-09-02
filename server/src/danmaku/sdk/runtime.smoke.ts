/**
 * Smoke test: 验证 Node vm 里的 webmssdk.js 能算出 X-Bogus。
 * 用法: tsx server/src/danmaku/sdk/runtime.smoke.ts
 *
 * 参考：抖音当前 X-Bogus 是 16 字符（参考 DouyinLiveWebFetcher/liveMan.py generateSignature）。
 */
import { getWebmsSdkRuntime, md5OfWssParams } from './runtime'

function main() {
  const runtime = getWebmsSdkRuntime()
  const sample =
    'wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/?live_id=1&aid=6383&version_code=180800&webcast_sdk_version=1.0.14-beta.0&room_id=7680244078071630633&user_unique_id=7680238365098198534&device_platform=web&identity=audience'
  const md5 = md5OfWssParams(sample)
  console.log(`md5=${md5}`)
  const xb = runtime.getXbogusFromWssUrl(sample)
  console.log(`X-Bogus via Node vm: ${xb} (len=${xb.length})`)
  if (xb.length !== 16) {
    console.error(`[smoke] FAIL: expected 16-char X-Bogus, got len=${xb.length}`)
    process.exit(1)
  }
  if (!/^[A-Za-z0-9+\/=]+$/.test(xb)) {
    console.error(`[smoke] FAIL: X-Bogus contains unexpected chars: ${xb}`)
    process.exit(1)
  }
  // 缓存命中
  const xb2 = runtime.getXbogusFromWssUrl(sample)
  if (xb2 !== xb) {
    console.error(`[smoke] FAIL: cache miss (first=${xb}, second=${xb2})`)
    process.exit(1)
  }
  console.log('[smoke] OK')
}
main()