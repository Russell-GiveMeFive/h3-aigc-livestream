/**
 * 用 Edge CDP 跑一次 dycast 原版，验证 wss 弹幕能正常收到
 * 不动任何 h3 项目代码，仅做黑盒验证
 */
import { chromium } from 'playwright'

const ROOM_ID = '10776146386'

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 5000 })
  console.log('[test] connected to Edge via CDP')
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = await context.newPage()

  // 拦截 wss 帧看是否有消息进来（控制台摘要）
  let wsCount = 0
  let frameCount = 0
  page.on('websocket', (ws) => {
    if (!ws.url().includes('douyin.com')) return
    wsCount++
    console.log(`[ws] #${wsCount} open: ${ws.url().slice(0, 100)}...`)
    ws.on('framereceived', () => {
      frameCount++
      if (frameCount <= 5 || frameCount % 50 === 0) console.log(`[ws] frame#${frameCount}`)
    })
    ws.on('close', () => console.log(`[ws] closed`))
    ws.on('socketerror', (err) => console.log(`[ws] error: ${err}`))
  })

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  console.log('[test] dycast loaded')

  // 找到房间号输入框：dycast 第一个 input
  await page.waitForSelector('input', { timeout: 10_000 })
  // 看看 dycast 怎么填的
  const inputs = await page.$$('input')
  console.log(`[test] found ${inputs.length} input(s)`)
  if (inputs.length === 0) {
    console.log('[test] FAIL: no input found on dycast page')
    return
  }
  await inputs[0].fill(ROOM_ID)

  // 探一下 dycast 窗口状态：window.getSign / byted_acrawler 注入成功没
  const sdkStatus = await page.evaluate(() => {
    const w = window as any
    return {
      hasGetSign: typeof w.getSign === 'function',
      hasBytedAcrawler: typeof w.byted_acrawler === 'object',
      hasFrontierSign: typeof w.byted_acrawler?.frontierSign,
    }
  })
  console.log(`[test] sdk status: ${JSON.stringify(sdkStatus)}`)

  // 找按钮
  const buttons = await page.$$('button')
  console.log(`[test] found ${buttons.length} button(s)`)
  if (buttons.length === 0) {
    console.log('[test] FAIL: no button found')
    return
  }
  // 第一个按钮通常是「连接」
  await buttons[0].click()
  console.log('[test] clicked first button (连接)')

  // 监听 page console 错误
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[dycast ${msg.type()}] ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => console.log(`[dycast pageerror] ${err.message}`))

  // 等连接结果（dycast 显示 connectCode=200 即成功）
  await page.waitForTimeout(15_000)

  // 拿当前 connectCode 显示
  const status = await page.evaluate(() => {
    const el = document.querySelector('.dy-room-info')
    return el?.textContent ?? 'no info element'
  })
  console.log(`[test] dycast status element: ${status}`)

  const finalUrl = page.url()
  console.log(`[test] final url: ${finalUrl}`)
  console.log(`[test] wsCount=${wsCount}, frameCount=${frameCount}`)

  if (frameCount > 0) {
    console.log('[test] ✅ SUCCESS: dycast received wss frames')
  } else if (wsCount > 0) {
    console.log('[test] ⚠️  PARTIAL: ws connected but no frames')
  } else {
    console.log('[test] ❌ FAIL: no ws connection')
  }

  await page.close()
}

main().catch((e) => {
  console.error('[test] crashed:', e)
  process.exit(1)
})