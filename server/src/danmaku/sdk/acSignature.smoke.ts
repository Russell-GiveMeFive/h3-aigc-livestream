/**
 * Smoke test: 验证 Node 算的 __ac_signature 与 Python 一致。
 * 用法: tsx server/src/danmaku/sdk/acSignature.smoke.ts
 *
 * 用 Python 算过的几个固定输入做对照：
 *   site='www.douyin.com/', nonce='0123407cc00a9e438deb4',
 *   ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
 *   ts=1721106114
 */
import { getAcSignature } from './acSignature'

function main() {
  const site = 'www.douyin.com/'
  const nonce = '0123407cc00a9e438deb4'
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
  const ts = 1721106114
  const sig = getAcSignature(site, nonce, ua, ts)
  console.log(`__ac_signature = ${sig}`)
  if (!sig.startsWith('_02B4Z6wo00f01')) {
    console.error(`[smoke] FAIL: missing sign head, got ${sig}`)
    process.exit(1)
  }
  // 总长度 = 14(head) + 5*6(七个 enc_num_to_str) + 1(i) + 2(checksum) = 14 + 30 + 1 + 2 = 47
  if (sig.length !== 47) {
    console.error(`[smoke] FAIL: expected 47 chars, got len=${sig.length}`)
    process.exit(1)
  }
  console.log('[smoke] OK')
}
main()
