import plugin from '../../../lib/plugins/plugin.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

/**
 * 帮助页（#mcsm help / #mcsm 菜单）
 * 源：mctool-plugin apps/mcsmanager/help.js
 */
export class McsmHelp extends plugin {
  constructor() {
    super({
      name: 'MCSManager-帮助',
      dsc: '显示MCSManager帮助信息',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcsm|MCSM)(help|帮助|菜单)$', fnc: 'help' }
      ]
    })
  }

  async help(e) {
    try {
      const { existsSync, mkdirSync, unlinkSync, readFileSync } = await import('node:fs')
      const puppeteer = (await import('puppeteer')).default

      const htmlPath = path.join(pluginRoot, 'resources', 'mcsmanager', 'html', 'help.html')
      const html = readFileSync(htmlPath, 'utf8')

      const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] })
      const page = await browser.newPage()
      await page.setViewport({ width: 860, height: 1000 })
      await page.setContent(html)
      try { await page.waitForSelector('.container', { timeout: 10000 }) } catch {}

      const bodyHandle = await page.$('body')
      const { height } = await bodyHandle.boundingBox()
      await bodyHandle.dispose()
      await page.setViewport({ width: 860, height: Math.ceil(height) })

      const imgPath = path.join(pluginRoot, 'resources', 'mcsmanager', 'temp')
      if (!existsSync(imgPath)) mkdirSync(imgPath, { recursive: true })
      const filePath = path.join(imgPath, `help_${Date.now()}.jpg`)
      await page.screenshot({ path: filePath, fullPage: true, quality: 100, type: 'jpeg' })
      await browser.close()

      await e.reply(segment.image(filePath))
      setTimeout(() => { try { unlinkSync(filePath) } catch {} }, 5000)
      return true
    } catch (error) {
      logger.error(`[MCSM][Help] 生成帮助信息失败:`, error)
      await e.reply('生成帮助信息失败，请稍后重试')
      return false
    }
  }
}
