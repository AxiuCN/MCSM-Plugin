import plugin from '../../../lib/plugins/plugin.js'
import template from 'art-template'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { ConfigManager } from '../components/ConfigManager.js'
import McsmApi from '../model/McsmApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')

/**
 * 实例管理
 * 源：mcsmanager-plugin（apps/mcsmanager/instance.js + models/mcsmanager/app/instance.js 合并）
 *
 * 命令：
 *   #mcsm list [页码]     — 实例列表
 *   #mcsm info <ID>       — 实例详情
 *   #mcsm start <ID>      — 启动
 *   #mcsm stop <ID>       — 停止
 *   #mcsm restart <ID>    — 重启
 *   #mcsm kill <ID>       — 强制结束
 *   #mcsm log <ID> [大小] — 查看日志
 *   #mcsm cmd <ID> <命令> — 发送命令
 */
export class McsmInstance extends plugin {
  static confirmations = new Map()

  constructor() {
    super({
      name: 'MCSManager-实例管理',
      dsc: 'MCSManager 实例管理指令',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcsm|MCSM)\\s*(实例列表|list)\\s*([0-9]*)?$', fnc: 'listInstances' },
        { reg: '^#?(mcsm|MCSM)\\s*(实例信息|info)\\s*([a-zA-Z0-9]+)$', fnc: 'instanceInfo' },
        { reg: '^#?(mcsm|MCSM)\\s*(启动|start)\\s*([a-zA-Z0-9]+)$', fnc: 'startInstance' },
        { reg: '^#?(mcsm|MCSM)\\s*(停止|stop)\\s*([a-zA-Z0-9]+)$', fnc: 'stopInstance' },
        { reg: '^#?(mcsm|MCSM)\\s*(重启|restart)\\s*([a-zA-Z0-9]+)$', fnc: 'restartInstance' },
        { reg: '^#?(mcsm|MCSM)\\s*(强制结束|kill)\\s*([a-zA-Z0-9]+)$', fnc: 'killInstance' },
        { reg: '^#?(mcsm|MCSM)\\s*(日志|log)\\s*([a-zA-Z0-9]+)\\s*(\\d+)?$', fnc: 'viewLog' },
        { reg: '^#?(mcsm|MCSM)\\s*(命令|cmd)\\s*([a-zA-Z0-9]+)\\s*(.+)$', fnc: 'sendCommand' }
      ]
    })
  }

  // ==================== 工具方法 ====================

  /** 根据序号解析 UUID */
  async parseInstanceId(userId, idOrIndex) {
    if (/^\d+$/.test(idOrIndex)) {
      const data = await ConfigManager.getUserBind(userId)
      if (!data?.panels?.length) throw new Error('请先使用 #mcsm bind 命令绑定面板')
      const index = parseInt(idOrIndex)
      if (index < 1) throw new Error('无效的实例序号')
      // 从面板获取实例列表
      const panel = data.panels[0]
      const api = new McsmApi(panel)
      const daemonId = panel.defaultDaemon
      if (!daemonId) throw new Error('请先同步实例（#mcsm syncinstances）')
      const list = await api.getInstanceList({ daemonId, page: 1, page_size: 50 })
      if (!list.data || index > list.data.length) throw new Error(`序号 ${index} 超出范围（共 ${list.data?.length || 0} 个实例）`)
      return list.data[index - 1].instanceUuid
    }
    return idOrIndex
  }

  /** 获取 daemonId */
  async getDaemonId(userId) {
    const data = await ConfigManager.getUserBind(userId)
    if (!data?.panels?.length) throw new Error('请先使用 #mcsm bind 命令绑定面板')
    return data.panels[0].defaultDaemon || ''
  }

  /* 获取 API 客户端 */
  async getApi(userId) {
    const panel = await ConfigManager.getActivePanel(userId)
    if (!panel) throw new Error('请先使用 #mcsm bind 命令绑定面板')
    return new McsmApi(panel)
  }

  /** 获取状态名称 */
  getStateName(state) {
    const states = { '-1': '忙碌', 0: '停止', 1: '停止中', 2: '启动中', 3: '运行中' }
    return states[String(state)] || '未知状态'
  }

  getConfirmKey(userId, groupId) {
    return `${userId}:${groupId}`
  }

  // ==================== 截图渲染 ====================

  async renderAndSend(e, htmlFile, data, filename) {
    const puppeteer = (await import('puppeteer')).default
    const htmlPath = path.join(pluginRoot, 'resources', 'mcsmanager', 'html', htmlFile)

    let html
    if (data !== null) {
      html = template(htmlPath, data)
    } else {
      html = (await import('node:fs')).readFileSync(htmlPath, 'utf8')
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const browserPage = await browser.newPage()
    await browserPage.setViewport({ width: 860, height: 1000 })
    await browserPage.setContent(html)

    try { await browserPage.waitForSelector('.container', { timeout: 10000 }) } catch {}

    const bodyHandle = await browserPage.$('body')
    const { height } = await bodyHandle.boundingBox()
    await bodyHandle.dispose()
    await browserPage.setViewport({ width: 860, height: Math.ceil(height) })

    const imgPath = path.join(pluginRoot, 'resources', 'mcsmanager', 'temp')
    if (!existsSync(imgPath)) mkdirSync(imgPath, { recursive: true })

    const filePath = path.join(imgPath, `${filename}_${Date.now()}.jpg`)
    await browserPage.screenshot({ path: filePath, fullPage: true, quality: 100, type: 'jpeg' })
    await browser.close()

    await e.reply(segment.image(filePath))
    setTimeout(() => {
      try { unlinkSync(filePath) } catch {}
    }, 5000)
  }

  // ==================== waitAndGetLog ====================

  async waitAndGetLog(e, inst, uuid, waitTime = 3000) {
    await new Promise(resolve => setTimeout(resolve, waitTime))
    const api = await this.getApi(e.user_id)
    const daemonId = await this.getDaemonId(e.user_id)

    try {
      const log = await api.getInstanceLog(uuid, daemonId, 1000)
      await this.renderAndSend(e, 'loginfo.html', { instance: inst, size: 1000, log }, 'instance_log')
    } catch (err) {
      logger.error(`[MCSM][Instance] 获取日志失败:`, err)
    }
  }

  // ==================== 实例列表 ====================

  async listInstances(e) {
    try {
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      const pageNum = parseInt(e.msg.match(/\d+/)?.[0] || '1')

      const result = await api.getInstanceList({ daemonId, page: pageNum, page_size: 10 })
      await this.renderAndSend(e, 'instancelist.html', result, 'instance_list')
      return true
    } catch (error) {
      await e.reply(error.message.includes('绑定') ? '请先使用 #mcsm bind 命令绑定面板' : `获取实例列表失败：${error.message}`)
      return false
    }
  }

  // ==================== 实例详情 ====================

  async instanceInfo(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(实例信息|info)\s*([a-zA-Z0-9]+)$/.exec(e.msg)
      if (!match) { await e.reply('格式错误！\n命令格式：#mcsm info <实例ID>\n例如：#mcsm info abc123def456'); return false }

      const uuid = await this.parseInstanceId(e.user_id, match[3])
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      const result = await api.getInstanceInfo(uuid, daemonId)

      const formatted = {
        ...result,
        config: { ...(result.config || {}), createTime: result.config?.createDatetime ? new Date(result.config.createDatetime).toLocaleString() : '未知' }
      }
      await this.renderAndSend(e, 'instanceinfo.html', { instance: formatted }, 'instance_info')
      return true
    } catch (error) {
      await e.reply(`获取实例信息失败：${error.message}`)
      return false
    }
  }

  // ==================== 实例操作 (start/stop/restart) ====================

  async startInstance(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(启动|start)\s*([a-zA-Z0-9]+)$/.exec(e.msg)
      if (!match) { await e.reply('格式错误！\n命令格式：#mcsm start <实例ID>'); return false }

      const uuid = await this.parseInstanceId(e.user_id, match[3])
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      const info = await api.getInstanceInfo(uuid, daemonId)
      const inst = info

      if (inst.status === 3) { await e.reply(`实例 ${inst.config?.nickname || uuid} 已经在运行中`); return false }
      if (inst.status === 2) { await e.reply(`实例 ${inst.config?.nickname || uuid} 正在启动中`); return false }

      await api.instanceOperation(uuid, 'open', daemonId)
      await e.reply(`实例 ${inst.config?.nickname || uuid} 启动指令已发送，正在等待启动...`)
      await this.waitAndGetLog(e, inst, uuid, 5000)
      return true
    } catch (error) {
      await e.reply(`启动实例失败：${error.message}`)
      return false
    }
  }

  async stopInstance(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(停止|stop)\s*([a-zA-Z0-9]+)$/.exec(e.msg)
      if (!match) { await e.reply('格式错误！\n命令格式：#mcsm stop <实例ID>'); return false }

      const uuid = await this.parseInstanceId(e.user_id, match[3])
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      const info = await api.getInstanceInfo(uuid, daemonId)
      const inst = info

      if (inst.status === 0) { await e.reply(`实例 ${inst.config?.nickname || uuid} 已经停止运行`); return false }
      if (inst.status === 1) { await e.reply(`实例 ${inst.config?.nickname || uuid} 正在停止中`); return false }

      await api.instanceOperation(uuid, 'stop', daemonId)
      await e.reply(`实例 ${inst.config?.nickname || uuid} 停止指令已发送，正在等待停止...`)
      await this.waitAndGetLog(e, inst, uuid)
      return true
    } catch (error) {
      await e.reply(`停止实例失败：${error.message}`)
      return false
    }
  }

  async restartInstance(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(重启|restart)\s*([a-zA-Z0-9]+)$/.exec(e.msg)
      if (!match) { await e.reply('格式错误！\n命令格式：#mcsm restart <实例ID>'); return false }

      const uuid = await this.parseInstanceId(e.user_id, match[3])
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      const info = await api.getInstanceInfo(uuid, daemonId)
      const inst = info

      if (inst.status === 1 || inst.status === 2) { await e.reply(`实例 ${inst.config?.nickname || uuid} 正在执行其他操作，请稍后再试`); return false }
      if (inst.status === -1) { await e.reply(`实例 ${inst.config?.nickname || uuid} 当前处于忙碌状态，请稍后再试`); return false }

      await api.instanceOperation(uuid, 'restart', daemonId)
      await e.reply(`实例 ${inst.config?.nickname || uuid} 重启指令已发送，正在等待重启...`)
      await this.waitAndGetLog(e, inst, uuid, 8000)
      return true
    } catch (error) {
      await e.reply(`重启实例失败：${error.message}`)
      return false
    }
  }

  // ==================== 强制结束 (需要确认) ====================

  async killInstance(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(强制结束|kill)\s*([a-zA-Z0-9]+)$/.exec(e.msg)
      if (!match) { await e.reply('格式错误！\n命令格式：#mcsm kill <实例ID>'); return false }

      const uuid = await this.parseInstanceId(e.user_id, match[3])
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      const info = await api.getInstanceInfo(uuid, daemonId)
      const inst = info

      if (inst.status === 0) { await e.reply(`实例 ${inst.config?.nickname || uuid} 已经停止运行`); return false }

      await e.reply(`警告：强制结束可能导致数据丢失！\n确定要强制结束实例 ${inst.config?.nickname || uuid} 吗？\n请回复"确定"继续操作，或回复其他内容取消`)

      const key = this.getConfirmKey(e.user_id, e.group_id)
      McsmInstance.confirmations.set(key, { uuid, name: inst.config?.nickname || uuid, time: Date.now() })

      setTimeout(() => {
        const confirm = McsmInstance.confirmations.get(key)
        if (confirm) { McsmInstance.confirmations.delete(key) }
      }, 30000)

      return true
    } catch (error) {
      await e.reply(`强制结束实例失败：${error.message}`)
      return false
    }
  }

  /** accept 处理确认消息 */
  async accept(e) {
    const key = this.getConfirmKey(e.user_id, e.group_id)
    const confirm = McsmInstance.confirmations.get(key)
    if (!confirm) return

    McsmInstance.confirmations.delete(key)
    if (e.msg !== '确定') { await e.reply('操作已取消'); return true }

    try {
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      await api.instanceOperation(confirm.uuid, 'kill', daemonId)
      await e.reply(`实例 ${confirm.name} 强制结束指令已发送`)
    } catch (error) {
      await e.reply(`强制结束实例失败：${error.message}`)
    }
    return true
  }

  // ==================== 日志和命令 ====================

  async viewLog(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(日志|log)\s*([a-zA-Z0-9]+)\s*(\d+)?$/.exec(e.msg)
      if (!match) {
        await e.reply('格式：\n#mcsm log <实例ID/序号> [日志大小KB]\n示例：#mcsm log 1 500')
        return true
      }
      const uuid = await this.parseInstanceId(e.user_id, match[3])
      const size = parseInt(match[4]) || 1000
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)
      const log = await api.getInstanceLog(uuid, daemonId, size)
      await this.renderAndSend(e, 'loginfo.html', { log, size }, 'instance_log')
      return true
    } catch (error) {
      await e.reply(`获取日志失败：${error.message}`)
      return false
    }
  }

  async sendCommand(e) {
    try {
      const match = /^#?(mcsm|MCSM)\s*(命令|cmd)\s*([a-zA-Z0-9]+)\s*(.+)$/.exec(e.msg)
      if (!match) {
        await e.reply('格式：\n#mcsm cmd <实例ID/序号> <命令>\n示例：#mcsm cmd 1 say Hello')
        return true
      }
      const uuid = await this.parseInstanceId(e.user_id, match[3])
      const command = match[4].trim()
      const api = await this.getApi(e.user_id)
      const daemonId = await this.getDaemonId(e.user_id)

      const info = await api.getInstanceInfo(uuid, daemonId)
      if (info.status !== 3) { await e.reply('实例未在运行，无法发送命令'); return false }

      await api.sendCommand(uuid, daemonId, command)
      await e.reply(`命令已发送至实例：\n${command}\n正在等待执行结果...`)
      await this.waitAndGetLog(e, info, uuid)
      return true
    } catch (error) {
      await e.reply(`发送命令失败：${error.message}`)
      return false
    }
  }
}
