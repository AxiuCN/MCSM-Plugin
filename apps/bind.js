import plugin from '../../../lib/plugins/plugin.js'
import { ConfigManager } from '../components/ConfigManager.js'
import McsmApi from '../model/McsmApi.js'

/**
 * 面板绑定管理
 * 源：mcsmanager-plugin（apps/mcsmanager/bind.js + models/mcsmanager/app/bind.js 合并）
 *
 * 命令：
 *   #mcsm bind <URL> <API密钥>  — 绑定面板
 *   #mcsm unbind                — 解绑
 *   #mcsm syncinstances         — 同步实例列表
 *   #mcsm bindinfo              — 查看绑定信息
 */
export class McsmBind extends plugin {
  constructor() {
    super({
      name: 'MCSManager-绑定',
      dsc: '绑定MCSManager实例',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcsm|MCSM)\\s*(绑定信息|bindinfo)$', fnc: 'info' },
        { reg: '^#?(mcsm|MCSM)\\s*(解绑|unbind)$', fnc: 'unbind' },
        { reg: '^#?(mcsm|MCSM)\\s*(同步实例|syncinstances)$', fnc: 'syncInstances' },
        { reg: '^#?(mcsm|MCSM)\\s*(绑定|bind)\\s*.*$', fnc: 'bind' }
      ]
    })
  }

  // ==================== 命令解析 ====================

  parseBindCommand(command) {
    let input = command.replace(/^#?(mcsm|MCSM)\s*(绑定|bind)\s*/, '').trim()

    let url, apiKey

    // 尝试匹配一体化格式: URL/apiKey
    const combinedMatch = input.match(/^(https?:\/\/[^\/]+)\/([a-zA-Z0-9]+)$/)
    if (combinedMatch) {
      [, url, apiKey] = combinedMatch
    } else {
      const params = input.split(/\s+/)
      if (params.length === 2) {
        [url, apiKey] = params
      } else {
        return null
      }
    }

    try { new URL(url) } catch { return null }
    return { url, apiKey }
  }

  // ==================== 绑定 ====================

  async bind(e) {
    if (!e.msg) {
      await e.reply('MCS绑定帮助：\n命令格式：#mcsm bind URL API密钥\n例如：#mcsm bind http://localhost:23333 your-api-key')
      return true
    }

    const bindInfo = this.parseBindCommand(e.msg)
    if (!bindInfo) {
      await e.reply('格式错误！\n命令格式：#mcsm bind URL API密钥\n例如：#mcsm bind http://localhost:23333 your-api-key')
      return false
    }

    try {
      await this.bindPanel(e.user_id, bindInfo.url, bindInfo.apiKey)
      await e.reply('绑定成功！您现在可以使用其他 MCSManager 命令了。')
      return true
    } catch (error) {
      logger.error(`[MCSM][Bind] 绑定失败:`, error)
      await e.reply('绑定失败，请检查输入是否正确，或联系管理员。')
      return false
    }
  }

  /** 执行面板绑定流程 */
  async bindPanel(userId, url, apiKey) {
    const host = new URL(url).hostname
    const port = parseInt(new URL(url).port) || 23333

    // 先保存基本信息
    await ConfigManager.bindPanel(userId, { host, port, apiKey, alias: host })

    // 获取面板用户列表来完善绑定信息
    const api = new McsmApi({ host, port, apiKey })
    const userListData = await api.getUserList({ page: 1, page_size: 20 })
    const currentUser = userListData.data.find(user => user.apiKey === apiKey)
    if (!currentUser) {
      // 无法找到对应用户也保存了基本信息
      return true
    }

    // 更新完整的绑定数据
    await ConfigManager.bindPanel(userId, {
      host, port, apiKey, alias: host,
      uuid: currentUser.uuid,
      userName: currentUser.userName,
      defaultInstance: currentUser.instances?.[0]?.instanceUuid || '',
      defaultDaemon: currentUser.instances?.[0]?.daemonId || ''
    })
    return true
  }

  // ==================== 解绑 ====================

  async unbind(e) {
    try {
      await ConfigManager.unbindPanel(e.user_id, 0)
      await e.reply('解绑成功！您的 MCSManager 配置已被删除。')
      return true
    } catch (error) {
      logger.error(`[MCSM][Bind] 解绑失败:`, error)
      await e.reply('解绑失败，请联系管理员。')
      return false
    }
  }

  // ==================== 同步实例 ====================

  async syncInstances(e) {
    try {
      const panel = await ConfigManager.getActivePanel(e.user_id)
      if (!panel) { await e.reply('请先使用 #mcsm bind 命令绑定面板'); return true }

      const api = new McsmApi(panel)
      const userListData = await api.getUserList({ page: 1, page_size: 20 })
      const userData = userListData.data.find(u => u.apiKey === panel.apiKey)

      if (!userData) { await e.reply('未找到对应的面板用户信息'); return false }

      await ConfigManager.bindPanel(e.user_id, {
        ...panel,
        uuid: userData.uuid,
        userName: userData.userName,
        defaultInstance: userData.instances?.[0]?.instanceUuid || '',
        defaultDaemon: userData.instances?.[0]?.daemonId || ''
      })

      const instanceCount = userData.instances?.length || 0
      const msg = [
        '实例同步成功！',
        `面板用户名：${userData.userName}`,
        `用户ID：${userData.uuid}`,
        `共同步了 ${instanceCount} 个实例`,
        ...(userData.instances || []).map((inst, i) => `${i + 1}. ${inst.instanceUuid} (${inst.name || '未命名'})`)
      ].join('\n')
      await e.reply(msg)
      return true
    } catch (error) {
      logger.error(`[MCSM][Bind] 同步实例失败:`, error)
      await e.reply(error.message === '用户未绑定面板'
        ? '请先使用 #mcsm bind 命令绑定面板'
        : '同步实例失败，请检查面板连接是否正常，或联系管理员。')
      return false
    }
  }

  // ==================== 获取绑定信息 ====================

  async info(e) {
    try {
      const data = await ConfigManager.getUserBind(e.user_id)
      if (!data?.panels?.length) { await e.reply('您尚未绑定任何面板'); return true }

      const panel = data.panels[0]
      const msg = [
        '您的 MCSManager 绑定信息：',
        `服务器地址：${panel.host}:${panel.port}`,
        `API密钥：${panel.apiKey ? panel.apiKey.slice(0, 8) + '****' : '未设置'}`,
        panel.userName ? `面板用户名：${panel.userName}` : '',
        panel.uuid ? `用户ID：${panel.uuid}` : '',
        panel.defaultInstance ? `默认实例：${panel.defaultInstance}` : ''
      ].filter(Boolean).join('\n')
      await e.reply(msg)
      return true
    } catch (error) {
      logger.error(`[MCSM][Bind] 获取绑定信息失败:`, error)
      await e.reply('获取绑定信息失败，请联系管理员。')
      return false
    }
  }
}
