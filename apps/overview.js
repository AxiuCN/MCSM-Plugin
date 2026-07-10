import plugin from '../../../lib/plugins/plugin.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigManager } from '../components/ConfigManager.js'
import McsmApi from '../model/McsmApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

/**
 * 面板概览 + 用户列表
 * 源：mctool-plugin（apps/mcsmanager/info.js + models/mcsmanager/app/info.js 合并，原 info.js 重命名为 overview.js）
 *
 * 命令：
 *   #mcsm overview  — 面板概览
 *   #mcsm users [页码] — 用户列表
 */
export class McsmOverview extends plugin {
  constructor() {
    super({
      name: 'MCSManager-信息',
      dsc: '获取MCSManager面板信息',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcsm|MCSM)\\s*(概览|overview)$', fnc: 'overview' },
        { reg: '^#?(mcsm|MCSM)\\s*(用户列表|users)\\s*(\\d+)?$', fnc: 'users' }
      ]
    })
  }

  async getApi(userId) {
    const panel = await ConfigManager.getActivePanel(userId)
    if (!panel) throw new Error('请先使用 #mcsm bind 命令绑定面板')
    return new McsmApi(panel)
  }

  async renderAndSend(e, htmlFile, data, filename) {
    const puppeteer = (await import('puppeteer')).default
    const template = (await import('art-template')).default
    const { existsSync, mkdirSync, unlinkSync } = await import('node:fs')

    const htmlPath = path.join(pluginRoot, 'resources', 'mcsmanager', 'html', htmlFile)
    const html = template(htmlPath, data)

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
    const filePath = path.join(imgPath, `${filename}_${Date.now()}.jpg`)
    await page.screenshot({ path: filePath, fullPage: true, quality: 100, type: 'jpeg' })
    await browser.close()

    await e.reply(segment.image(filePath))
    setTimeout(() => { try { unlinkSync(filePath) } catch {} }, 5000)
  }

  async overview(e) {
    try {
      const api = await this.getApi(e.user_id)
      const data = await api.getOverview()
      await this.renderAndSend(e, 'info.html', data, 'overview')
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `获取概览信息失败：${error.message}`)
      return false
    }
  }

  async users(e) {
    try {
      const api = await this.getApi(e.user_id)
      const pageNum = parseInt(e.msg.match(/\d+/)?.[0] || '1')
      const result = await api.getUserList({ page: pageNum, page_size: 10 })
      const data = {
        users: result.data || [],
        page: result.page,
        pageSize: result.pageSize,
        maxPage: result.maxPage
      }

      if (data.users.length === 0) { await e.reply('暂无用户数据'); return true }
      await this.renderAndSend(e, 'userinfo.html', data, 'userlist')
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `获取用户列表失败：${error.message}`)
      return false
    }
  }
}
