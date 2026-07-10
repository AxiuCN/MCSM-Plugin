import plugin from '../../../lib/plugins/plugin.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigManager } from '../components/ConfigManager.js'
import McsmApi from '../model/McsmApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

// 全局下载锁
if (!global.mcsDownloadLocks) global.mcsDownloadLocks = new Set()

/**
 * 文件管理
 * 源：mctool-plugin（apps/mcsmanager/files.js + models/mcsmanager/app/files.js 合并）
 *
 * 命令：
 *   #mcsm files <实例序号> [页码] [路径] — 浏览文件
 *   #mcsm download <实例序号> <文件路径>    — 下载文件
 */
export class McsmFiles extends plugin {
  constructor() {
    super({
      name: 'MCSManager-文件',
      dsc: 'MCSManager 文件管理',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcsm|MCSM)\\s*(文件列表|files)\\s*(\\d+)(?:\\s+(\\d+))?(?:\\s+([^\\s]+))?$', fnc: 'listFiles' },
        { reg: '^#?(mcsm|MCSM)\\s*(下载文件|download)\\s*(\\d+)\\s+(.+)$', fnc: 'downloadFile' }
      ]
    })
  }

  async getApi(userId) {
    const panel = await ConfigManager.getActivePanel(userId)
    if (!panel) throw new Error('请先使用 #mcsm bind 命令绑定面板')
    return new McsmApi(panel)
  }

  formatSize(size) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let index = 0
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index++ }
    return `${size.toFixed(2)} ${units[index]}`
  }

  async listFiles(e) {
    try {
      const match = e.msg.match(/^#?(mcsm|MCSM)\s*(文件列表|files)\s*(\d+)(?:\s+(\d+))?(?:\s+([^\s]+))?$/)
      if (!match) { await e.reply('格式：#mcsm files <实例序号> [页码] [路径]'); return false }

      const instanceIndex = match[3]
      const pageNum = match[4] ? parseInt(match[4]) : 1
      const targetPath = match[5] || '/'

      const api = await this.getApi(e.user_id)
      const daemonId = await this._getDaemonId(e.user_id)

      const result = await api.getFileList(daemonId, instanceIndex, targetPath, pageNum - 1, 100)

      const { existsSync, mkdirSync, unlinkSync } = await import('node:fs')
      const puppeteer = (await import('puppeteer')).default
      const template = (await import('art-template')).default

      const htmlPath = path.join(pluginRoot, 'resources', 'mcsmanager', 'html', 'filelist.html')
      const htmlTemplate = (await import('node:fs')).readFileSync(htmlPath, 'utf8')

      const data = {
        ...result,
        formatSize: (s) => this.formatSize(s),
        formatTime: (t) => new Date(t).toLocaleString()
      }
      const html = template.render(htmlTemplate, data)

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
      const filePath = path.join(imgPath, `filelist_${Date.now()}.jpg`)
      await page.screenshot({ path: filePath, fullPage: true, quality: 100, type: 'jpeg' })
      await browser.close()

      await e.reply(segment.image(filePath))
      setTimeout(() => { try { unlinkSync(filePath) } catch {} }, 5000)
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `获取文件列表失败：${error.message}`)
      return false
    }
  }

  async downloadFile(e) {
    let savePath = ''
    try {
      const match = e.msg.match(/^#?(mcsm|MCSM)\s*(下载文件|download)\s*(\d+)\s+(.+)$/)
      if (!match) { await e.reply('格式：#mcsm download <实例序号> <文件路径>'); return false }

      const instanceIndex = match[3]
      const filePath = match[4].trim()
      const lockKey = `${instanceIndex}:${filePath}`

      if (global.mcsDownloadLocks.has(lockKey)) { await e.reply('文件正在下载中，请等待当前下载完成'); return false }
      global.mcsDownloadLocks.add(lockKey)

      try {
        const api = await this.getApi(e.user_id)
        const daemonId = await this._getDaemonId(e.user_id)
        const fileName = filePath.split('/').pop()

        // 获取下载配置
        const config = await api.getFileDownloadConfig(daemonId, instanceIndex, filePath)

        const { existsSync, mkdirSync, unlinkSync } = await import('node:fs')
        const downloadPath = path.join(pluginRoot, 'resources', 'mcsmanager', 'downloads')
        if (!existsSync(downloadPath)) mkdirSync(downloadPath, { recursive: true })
        savePath = path.join(downloadPath, fileName)

        await e.reply(`开始下载文件: ${fileName}`)
        await api.downloadFile(config.addr, config.password, fileName, savePath)

        await e.reply(segment.file(savePath, fileName))
        setTimeout(() => { try { unlinkSync(savePath) } catch {} }, 5000)
        return true
      } finally {
        global.mcsDownloadLocks.delete(lockKey)
      }
    } catch (error) {
      if (savePath) { try { (await import('node:fs')).unlinkSync(savePath) } catch {} }
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `下载文件失败：${error.message}`)
      return false
    }
  }

  async _getDaemonId(userId) {
    const data = await ConfigManager.getUserBind(userId)
    return data?.panels?.[0]?.defaultDaemon || ''
  }
}
