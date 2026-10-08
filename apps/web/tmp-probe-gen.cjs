const { chromium } = require('playwright')

const URL = 'http://127.0.0.1:3082/?token=kQncNK4drVOs2VhSwHAQz_i4xPggIjFZ2qDrVZqheyY'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 300)))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)) })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)

  const enterBtn = page.locator('[role="group"][aria-label="创作台"] button', { hasText: '创作台' }).first()
  await enterBtn.click()
  await page.waitForTimeout(1200)

  const ta = page.locator('.centerPane:not(:first-child) textarea, div.centerPane textarea').last()
  const taCount = await page.locator('textarea').count()
  // The workbench textarea: find by placeholder containing '1girl' (workbench locales) or the last visible one.
  const wbTa = page.locator('textarea[placeholder*="1girl"], textarea').last()
  await wbTa.fill('一只戴围巾的橘猫坐在雪地里，832x1216')
  const genBtn = page.getByRole('button', { name: /^生成|Generate$/ }).last()
  console.log('generate button count:', await genBtn.count())
  await genBtn.click()
  console.log('clicked, waiting for result...')
  let verdict = 'timeout'
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000)
    const alert = await page.locator('[role="alert"]').count()
    if (alert > 0) {
      const t = await page.locator('[role="alert"]').first().textContent()
      verdict = 'ALERT: ' + (t || '').slice(0, 200)
      break
    }
    const doneP = await page.locator('p').filter({ hasText: /\.(png|webp)/ }).count()
    if (doneP > 0) { verdict = 'DONE: ' + (await page.locator('p').filter({ hasText: /\.(png|webp)/ }).first().textContent()); break }
  }
  console.log('VERDICT:', verdict)
  console.log('ERRORS:', JSON.stringify(errors.slice(0, 8)))
  await page.screenshot({ path: process.env.TEMP + '\\workbench-gen.png' })
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
