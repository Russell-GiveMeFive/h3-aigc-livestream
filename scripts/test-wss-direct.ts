/**
 * 直接在用户已登录的 Edge 浏览器里开 wss，验证浏览器侧签名+cookie 路径通不通
 * 拿到帧数即证明：浏览器里 new WebSocket(wssUrl) 是可行的方案
 */
import { chromium } from 'playwright'

const ROOM_ID = '10776146386'
const UNIQUE_ID = '7680238365098198534' // 从 sign-server 上一次 MATCHED 拿到的

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 5000 })
  console.log('[wss-test] connected to Edge')
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[page-error] ${msg.text()}`)
  })
  page.on('pageerror', (err) => console.log(`[page-err] ${err.message}`))

  // 先开 dycast 让 SDK 注入（dycast 加载 webmssdk.js）
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  console.log('[wss-test] dycast loaded, waiting for SDK injection')

  // 探 SDK 状态
  const status = await page.evaluate(() => {
    const w = window as any
    return {
      hasGetSign: typeof w.getSign === 'function',
      hasFrontierSign: typeof w.byted_acrawler?.frontierSign,
    }
  })
  console.log(`[wss-test] sdk: ${JSON.stringify(status)}`)
  if (!status.hasGetSign) {
    console.log('[wss-test] FAIL: getSign not injected')
    return
  }

  // 在浏览器内算签名 + 开 wss（完全模拟 dycast 的 connection() 逻辑）
  const result = await page.evaluate(
    async ([roomId, uniqueId]: [string, string]) => {
      const w = window as any
      try {
        // 1. 拿签名
        const signObj = w.getSign(roomId, uniqueId)
        const sign = signObj['X-Bogus']
        if (!sign) throw new Error('no X-Bogus in getSign result')

        // 2. 拼 wss URL（dycast 原版格式）
        const now = Date.now()
        const ua = encodeURIComponent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36 Edg/111.0.1661.62',
        )
        const internalExt =
          `internal_src:dim|wss_push_room_id:${roomId}` +
          `|wss_push_did:${uniqueId}` +
          `|fetch_time:${now}|seq:1|wss_info:0-${now}-0-0`
        const cursor = `t-${now}_r-1_d-1_u-1_h-1`
        const url =
          `wss://webcast3-ws-web-hl.douyin.com/webcast/im/push/v2/?` +
          `app_name=douyin_web&version_code=180800&webcast_sdk_version=1.3.0&update_version_code=1.3.0&compress=gzip` +
          `&internal_ext=${internalExt}&cursor=${cursor}` +
          `&host=https://live.douyin.com&aid=6383&live_id=1&did_rule=3&debug=false&maxCacheMessageNumber=20` +
          `&endpoint=live_pc&support_wrds=1&im_path=/webcast/im/fetch/` +
          `&user_unique_id=${uniqueId}&device_platform=web&cookie_enabled=true` +
          `&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=Win32` +
          `&browser_name=Mozilla&browser_version=${ua}&browser_online=true` +
          `&tz_name=Asia/Shanghai&identity=audience&room_id=${roomId}` +
          `&heartbeatDuration=0&signature=${sign}`

        // 3. 开 wss，截前几个 frame 的 method 字段
        return new Promise<{ url: string; sig: string; frames: string[]; err?: string }>(
          (resolve) => {
            const ws = new WebSocket(url)
            ws.binaryType = 'arraybuffer'
            const frames: string[] = []
            const timeout = setTimeout(() => {
              try {
                ws.close()
              } catch {}
              resolve({
                url: url.slice(0, 80) + '…',
                sig: sign.slice(0, 16) + '…',
                frames,
              })
            }, 12_000)

            ws.onopen = () => {
              console.log('[browser-ws] open')
              // 简单心跳（dycast 不发，只等服务器推）
            }
            ws.onmessage = (e: MessageEvent) => {
              const data = e.data as ArrayBuffer
              const bytes = new Uint8Array(data)
              // 简单嗅探前几字节：PushFrame 第一字段 logId=uint64(1)
              // 这里只截前 16 字节 hex 用于诊断
              const hex = Array.from(bytes.slice(0, 16))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
              frames.push(hex)
              if (frames.length >= 3) {
                clearTimeout(timeout)
                ws.close()
                resolve({
                  url: url.slice(0, 80) + '…',
                  sig: sign.slice(0, 16) + '…',
                  frames,
                })
              }
            }
            ws.onerror = (e: Event) => {
              clearTimeout(timeout)
              resolve({
                url: url.slice(0, 80) + '…',
                sig: sign.slice(0, 16) + '…',
                frames,
                err: 'wserror: ' + (e as any).message,
              })
            }
            ws.onclose = (e: CloseEvent) => {
              if (frames.length === 0) {
                clearTimeout(timeout)
                resolve({
                  url: url.slice(0, 80) + '…',
                  sig: sign.slice(0, 16) + '…',
                  frames,
                  err: 'wsclose code=' + e.code + ' reason=' + e.reason,
                })
              }
            }
          },
        )
      } catch (e) {
        return { url: '', sig: '', frames: [], err: (e as Error).message }
      }
    },
    [ROOM_ID, UNIQUE_ID] as [string, string],
  )

  console.log(`[wss-test] sig=${result.sig}`)
  console.log(`[wss-test] frames=${result.frames.length}, err=${result.err ?? 'none'}`)
  for (let i = 0; i < Math.min(3, result.frames.length); i++) {
    console.log(`[wss-test] frame[${i}] hex: ${result.frames[i]}`)
  }
  if (result.err) {
    console.log(`[wss-test] ❌ FAIL: ${result.err}`)
  } else if (result.frames.length > 0) {
    console.log(`[wss-test] ✅ SUCCESS: browser-side wss works`)
  }
}

main().catch((e) => {
  console.error('[wss-test] crashed:', e)
  process.exit(1)
})