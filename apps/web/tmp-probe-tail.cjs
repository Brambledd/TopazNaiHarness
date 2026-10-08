const { chromium } = require('playwright')

const URL = 'http://127.0.0.1:3082/?token=9fpBZ-p5eUG4QEkl-jyqCsRmN0OK2xj7-82VuD77EQY'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 200)))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  await page.getByText('新会话', { exact: false }).first().click().catch(() => {})
  await page.waitForTimeout(1500)
  const box = page.locator('textarea, [contenteditable="true"]').first()
  await box.click()
  await box.fill('画一只橘猫趴在窗台上晒太阳，832x1216')
  await page.keyboard.press('Enter')
  console.log('sent')

  let verdict = 'timeout'
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(3000)
    const tail = page.locator('[data-tool="novelai_generate-images"] img').first()
    if (await tail.count() > 0) {
      const state = await tail.evaluate(el => el.complete + '|' + el.naturalWidth + 'x' + el.naturalHeight).catch(() => 'gone')
      if (/true\|[1-9]/.test(state)) { verdict = 'TAIL IMG ' + state; break }
    }
  }
  if (verdict.startsWith('TAIL')) {
    const rowImgs = await page.locator('[data-tool="novelai_generate"] img').count()
    console.log('process-fold imgs (expect 0):', rowImgs)
    for (let s = 5; s <= 15; s += 5) {
      await page.waitForTimeout(5000)
      const tail = page.locator('[data-tool="novelai_generate-images"] img').first()
      const still = await tail.count() > 0
        ? await tail.evaluate(el => el.complete + '|' + el.naturalWidth + 'x' + el.naturalHeight).catch(() => 'eval-gone')
        : 'dom-gone'
      console.log('t+' + s + 's:', still)
      if (!/true\|[1-9]/.test(still)) { verdict = 'VANISHED t+' + s + 's'; break }
    }
  }
  await page.screenshot({ path: process.env.TEMP + '\\novelai-e2e3.png' })
  console.log('VERDICT:', verdict)
  console.log('errors:', JSON.stringify(errors.slice(0, 5)))
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
