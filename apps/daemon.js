import plugin from '../../../lib/plugins/plugin.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigManager } from '../components/ConfigManager.js'
import McsmApi from '../model/McsmApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

/**
 * 守护进程节点管理
 * 源：mctool-plugin（apps/mcsmanager/daemon.js + models/mcsmanager/app/daemon.js 合并）
 *
 * 命令：
 *   #mcsm add-node <IP> <端口> <API密钥> [备注]
 *   #mcsm del-node <序号>
 *   #mcsm link-node <序号>
 *   #mcsm nodes
 */
export class McsmDaemon extends plugin {
  constructor() {
    super({
      name: 'MCSManager-守护进程',
      dsc: 'MCSManager 守护进程管理指令',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcsm|MCSM)\\s*(添加节点|add-node)(?:\\s+([\\s\\S]+))?$', fnc: 'addNode' },
        { reg: '^#?(mcsm|MCSM)\\s*(删除节点|del-node)\\s*([\\d]+)$', fnc: 'deleteNode' },
        { reg: '^#?(mcsm|MCSM)\\s*(连接节点|link-node)\\s*([\\d]+)$', fnc: 'linkNode' },
        { reg: '^#?(mcsm|MCSM)\\s*(节点列表|nodes)$', fnc: 'listNodes' }
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

  async addNode(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(添加节点|add-node)\s*(\S+)\s*(\d+)\s*(\S+)(?:\s*(.+))?$/.exec(e.msg)
      if (!match) {
        await e.reply('格式：#mcsm add-node <IP> <端口> <API密钥> [备注]\n示例：#mcsm add-node 10.0.0.16 24446 abc123 树莓派')
        return true
      }
      const [, , , ip, port, apiKey, remarks] = match

      const api = await this.getApi(e.user_id)
      const result = await api.addDaemonNode({ ip, port: parseInt(port), apiKey, remarks: remarks || '' })

      await e.reply([`守护进程节点添加成功！`, `节点ID: ${result}`, `IP地址: ${ip}:${port}`, remarks ? `备注: ${remarks}` : ''].filter(Boolean).join('\n'))
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `添加节点失败：${error.message}`)
      return false
    }
  }

  async listNodes(e) {
    try {
      const api = await this.getApi(e.user_id)
      const overview = await api.getOverview()
      const nodes = overview.remote || []

      if (nodes.length === 0) { await e.reply('当前没有守护进程节点'); return true }

      const data = {
        nodes: nodes.map(n => ({ ...n, daemonId: n.uuid, remarks: n.remarks || n.ip || '' })),
        getStatusText: (s) => ({ 0: '已停止', 1: '正在启动', 2: '正在停止', 3: '运行中' })[s] || '未知',
        getStatusClass: (s) => ({ 0: 'status-stopped', 1: 'status-starting', 2: 'status-stopping', 3: 'status-running' })[s] || ''
      }
      await this.renderAndSend(e, 'daemonlist.html', data, 'daemonlist')
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `获取节点列表失败：${error.message}`)
      return false
    }
  }

  async deleteNode(e) {
    try {
      const api = await this.getApi(e.user_id)
      const overview = await api.getOverview()
      const nodes = overview.remote || []
      const index = parseInt(/^#?(mcsm|MCSM)\s*(删除节点|del-node)\s*(\d+)$/.exec(e.msg)[3])

      if (index < 1 || index > nodes.length) { await e.reply('节点序号不存在，请使用 #mcsm nodes 查看节点列表'); return false }
      const node = nodes[index - 1]
      await api.deleteDaemonNode(node.uuid)
      await e.reply(`守护进程节点删除成功！\n节点ID: ${node.uuid}`)
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `删除节点失败：${error.message}`)
      return false
    }
  }

  async linkNode(e) {
    try {
      const api = await this.getApi(e.user_id)
      const overview = await api.getOverview()
      const nodes = overview.remote || []
      const index = parseInt(/^#?(mcsm|MCSM)\s*(连接节点|link-node)\s*(\d+)$/.exec(e.msg)[3])

      if (index < 1 || index > nodes.length) { await e.reply('节点序号不存在，请使用 #mcsm nodes 查看节点列表'); return false }
      const node = nodes[index - 1]
      await api.linkDaemonNode(node.uuid)
      await e.reply(`守护进程节点连接成功！\n节点ID: ${node.uuid}`)
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `连接节点失败：${error.message}`)
      return false
    }
  }
}
