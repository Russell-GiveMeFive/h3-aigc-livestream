import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = '/tmp'

async function ensureNoWindowError(page) {
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

async function checkLayout(page, tab) {
  await page.click(`button.tab-btn:has-text("${tab}")`)
  await page.waitForTimeout(300)
  const dims = await page.evaluate(() => {
    const video = document.querySelector('.preview-player')
    const placeholder = document.querySelector('.preview-placeholder')
    const layoutPane = document.querySelector('.layout-pane:not([hidden])')
    return {
      videoWidth: video ? video.getBoundingClientRect().width : null,
      videoHeight: video ? video.getBoundingClientRect().height : null,
      placeholderWidth: placeholder ? placeholder.getBoundingClientRect().width : null,
      layoutPaneWidth: layoutPane ? layoutPane.getBoundingClientRect().width : null,
      layoutPaneHidden: layoutPane ? layoutPane.hidden : null,
    }
  })
  return dims
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const page = await ctx.newPage()
  const errors = await ensureNoWindowError(page)
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser-err]', msg.text())
  })

  console.log('--- /streamer ---')
  await page.goto(`${BASE}/streamer`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // tab 1: workbench
  const w = await checkLayout(page, '工作台')
  console.log('workbench', w)
  await page.screenshot({ path: `${OUT}/tab-workbench.png`, fullPage: true })

  // start wizard → triggers roomId / begins workflow
  // Skip: would require API key

  // tab 2: config
  const c = await checkLayout(page, '配置')
  console.log('config', c)
  await page.screenshot({ path: `${OUT}/tab-config.png`, fullPage: true })

  // tab 3: log
  const l = await checkLayout(page, '日志')
  console.log('log', l)
  await page.screenshot({ path: `${OUT}/tab-log.png`, fullPage: true })

  // back to workbench to verify state preservation
  const w2 = await checkLayout(page, '工作台')
  console.log('workbench (back)', w2)

  console.log('--- pageerrors ---')
  console.log(errors)

  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })