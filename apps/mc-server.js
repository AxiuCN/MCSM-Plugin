import plugin from '../../../lib/plugins/plugin.js'
import common from '../../../lib/common/common.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { queryServerStatus } from '../model/McServerApi.js'

/**
 * Minecraft 服务器管理
 * 源：mctool-plugin apps/mc-server.js
 *
 * 命令：
 *   #mc add <名称> <地址> [描述]  — 添加服务器 (admin)
 *   #mc del <ID>                 — 删除服务器 (admin)
 *   #mc status / list            — 服务器列表
 *   #mc online                   — 在线玩家
 *   #mc motd <地址[:端口]>       — 查询MOTD
 */
export class McServer extends plugin {
  constructor() {
    super({
      name: 'MCTool-服务器',
      dsc: 'Minecraft服务器管理',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?[Mm][Cc](添加|add)\\s+\\S+\\s+\\S+\\s*.*$', fnc: 'addServer', permission: 'admin' },
        { reg: '^#?[Mm][Cc](删除|del)\\s+\\d+$', fnc: 'deleteServer', permission: 'admin' },
        { reg: '^#?[Mm][Cc](状态|status|列表|list)$', fnc: 'getServerList', permission: 'all' },
        { reg: '^#?[Mm][Cc](在线|online)$', fnc: 'getOnlinePlayers', permission: 'all' },
        { reg: '^#?[Mm][Cc]motd(?:\\s+\\S+(?::\\d+)?)?$', fnc: 'queryMotd', permission: 'all' }
      ]
    })
  }

  async checkGroupAdmin(e) {
    if (!e.isGroup) { e.reply('该功能仅群聊使用'); return false }
    try {
      const memberInfo = await e.group.getMemberMap()
      const userInfo = memberInfo.get(e.user_id)
      if (!(['owner', 'admin'].includes(userInfo.role) || e.isMaster)) { e.reply('该功能需要群管理员权限'); return false }
      return true
    } catch (err) {
      logger.error('[MCSM][MCServer] 检查管理员权限失败:', err)
      return false
    }
  }

  // ==================== 添加服务器 ====================

  async addServer(e) {
    if (!await this.checkGroupAdmin(e)) return
    try {
      const match = e.msg.match(/^#[Mm][Cc](?:add|添加)\s+(\S+)\s+(\S+)\s*(.*)$/)
      if (!match) { e.reply('格式错误\n用法: #mc添加 <名称> <地址> [描述]'); return }

      const [, name, address, description = ''] = match
      await ConfigManager.addMcServer({ name, host: address, description })
      e.reply(`服务器添加成功\n名称: ${name}\n地址: ${address}\n描述: ${description}`)
    } catch (error) {
      logger.error('[MCSM][MCServer] 添加服务器失败:', error)
      e.reply('添加服务器失败，请稍后重试')
    }
  }

  // ==================== 删除服务器 ====================

  async deleteServer(e) {
    if (!await this.checkGroupAdmin(e)) return
    try {
      const match = e.msg.match(/^#[Mm][Cc](?:del|删除)\s+(\d+)$/)
      if (!match) { e.reply('格式错误\n用法: #mc删除 <ID>'); return }

      const serverId = parseInt(match[1])
      const servers = await ConfigManager.getMcServers()
      if (serverId < 0 || serverId >= servers.length) { e.reply(`未找到ID为 ${serverId} 的服务器`); return }

      const info = servers[serverId]
      await ConfigManager.deleteMcServer(serverId)
      e.reply(`已删除服务器\nID: ${serverId}\n名称: ${info.name}`)
    } catch (error) {
      logger.error('[MCSM][MCServer] 删除服务器失败:', error)
      e.reply('删除失败，请稍后重试')
    }
  }

  // ==================== MOTD ====================

  async queryMotd(e) {
    try {
      const match = e.msg.match(/^#?[Mm][Cc]motd(?:\s+(\S+(?::\d+)?))?$/)
      const address = match[1]?.trim()
      if (!address) { e.reply('格式错误\n用法: #mcmotd <服务器地址[:端口]>\n例如：#mcmotd mc.hypixel.net'); return true }

      // 使用默认 API 配置
      const api = { name: 'default', url: 'https://api.mcsrvstat.us/2/{host}', timeout: 10, maxRetries: 2, retryDelay: 1000, parser: { online: 'online', players: { online: 'players.online', max: 'players.max', list: 'players.list' }, version: 'version', motd: 'motd.clean' } }

      const motdInfo = await queryServerStatus(address, api)
      if (!motdInfo) { e.reply('服务器离线或无法访问'); return true }

      const msg = [
        `服务器信息：${address}`, `状态：${motdInfo.online ? '在线' : '离线'}`,
        motdInfo.version ? `\n版本：${motdInfo.version}` : '',
        motdInfo.motd ? `\nMOTD：${motdInfo.motd}` : '',
        motdInfo.players ? `\n在线人数：${motdInfo.players.online}/${motdInfo.players.max}` : '',
        motdInfo.players?.list?.length > 0 ? `\n在线玩家：${motdInfo.players.list.join(', ')}` : ''
      ].filter(Boolean).join('')

      e.reply(msg)
      return true
    } catch (error) {
      logger.error('[MCSM][MCServer] 查询MOTD失败:', error)
      e.reply('查询失败，请检查服务器地址格式是否正确')
      return false
    }
  }

  // ==================== 服务器列表 ====================

  async getServerList(e) {
    try {
      const servers = await ConfigManager.getMcServers()
      if (servers.length === 0) { e.reply('当前未添加任何服务器'); return true }

      const api = { name: 'default', url: 'https://api.mcsrvstat.us/2/{host}', timeout: 10, maxRetries: 2, retryDelay: 1000, parser: { online: 'online', players: { online: 'players.online', max: 'players.max', list: 'players.list' }, version: 'version', motd: 'motd.clean' } }

      const messages = ['服务器列表：\n可用命令：\n#mc添加 <名称> <地址> [描述] - 添加服务器\n#mc删除 <ID> - 删除服务器\n#mc在线 - 查看服务器在线状态']

      for (let i = 0; i < servers.length; i++) {
        const srv = servers[i]
        try {
          const status = await queryServerStatus(srv.host, api)
          let statusText = '未知'
          if (status) {
            if (!status.online) statusText = '离线'
            else { statusText = '在线'; statusText += `\n在线人数: ${status.players.online}/${status.players.max}`; if (status.version) statusText += `\n版本: ${status.version}` }
          }
          messages.push(`服务器信息 [${i}]:\n名称: ${srv.name}\n地址: ${srv.host}\n描述: ${srv.description || '无'}\n状态: ${statusText}`)
        } catch {
          messages.push(`服务器信息 [${i}]:\n名称: ${srv.name}\n地址: ${srv.host}\n描述: ${srv.description || '无'}\n状态: 查询出错`)
        }
        if (servers.length > 1) await new Promise(resolve => setTimeout(resolve, 500))
      }

      await this.reply_forward_msg(e, messages)
      return true
    } catch (error) {
      logger.error('[MCSM][MCServer] 获取服务器列表失败:', error)
      e.reply('获取服务器列表失败，请稍后重试')
      return true
    }
  }

  async getOnlinePlayers(e) {
    try {
      const servers = await ConfigManager.getMcServers()
      if (servers.length === 0) { e.reply('当前未添加任何服务器'); return true }

      const api = { name: 'default', url: 'https://api.mcsrvstat.us/2/{host}', timeout: 10, maxRetries: 2, retryDelay: 1000, parser: { online: 'online', players: { online: 'players.online', max: 'players.max', list: 'players.list' }, version: 'version', motd: 'motd.clean' } }

      const messages = ['服务器在线状态：']
      for (let i = 0; i < servers.length; i++) {
        const srv = servers[i]
        try {
          const status = await queryServerStatus(srv.host, api)
          let msg = `[${i}] ${srv.name}`
          if (!status || !status.online) { msg += ': 离线' }
          else {
            msg += `\n在线人数: ${status.players.online}/${status.players.max}`
            const names = (status.players.list || []).map(p => typeof p === 'string' ? p : p.name).filter(Boolean)
            if (names.length > 0) msg += `\n在线玩家: ${names.join('、')}`
            else if (status.players.online > 0) msg += '\n未展示玩家列表'
            else msg += '\n当前无玩家在线'
          }
          messages.push(msg)
        } catch {
          messages.push(`[${i}] ${srv.name}: 查询出错`)
        }
        if (servers.length > 1) await new Promise(resolve => setTimeout(resolve, 500))
      }

      await this.reply_forward_msg(e, messages)
      return true
    } catch (error) {
      logger.error('[MCSM][MCServer] 获取在线玩家失败:', error)
      e.reply('获取在线玩家失败，请稍后重试')
      return true
    }
  }

  async reply_forward_msg(e, messages) {
    try {
      const msg = await common.makeForwardMsg(e, messages, '服务器状态信息')
      await e.reply(msg)
    } catch (error) {
      logger.error('[MCSM][MCServer] 发送转发消息失败:', error)
      e.reply('发送消息失败，请稍后重试')
    }
  }
}
