import plugin from '../../../lib/plugins/plugin.js'
import { ConfigManager } from '../components/ConfigManager.js'
import McsmApi from '../model/McsmApi.js'

/**
 * 面板用户管理
 * 源：mcsmanager-plugin（apps/mcsmanager/usermod.js + models/mcsmanager/app/usermod.js 合并）
 *
 * 命令：
 *   #mcsm createuser <用户名> <密码> <权限>
 *   #mcsm deleteuser <用户名或ID>
 *   #mcsm setperm <用户名或ID> <权限值>
 *   #mcsm resetpwd <用户名或ID> <新密码>
 */
export class McsmUser extends plugin {
  constructor() {
    super({
      name: 'MCSManager-用户管理',
      dsc: '管理MCSManager用户',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcsm|MCSM)\\s*(创建用户|createuser)\\s*.*$', fnc: 'createUser' },
        { reg: '^#?(mcsm|MCSM)\\s*(删除用户|deleteuser)\\s*.*$', fnc: 'deleteUser' },
        { reg: '^#?(mcsm|MCSM)\\s*(修改权限|setperm)\\s*.*$', fnc: 'changePermission' },
        { reg: '^#?(mcsm|MCSM)\\s*(重置密码|resetpwd)\\s*.*$', fnc: 'resetPassword' }
      ]
    })
  }

  async getApi(userId) {
    const panel = await ConfigManager.getActivePanel(userId)
    if (!panel) throw new Error('请先使用 #mcsm bind 命令绑定面板')
    return new McsmApi(panel)
  }

  getPermissionName(permission) {
    switch (Number(permission)) {
      case 10: return '管理员'
      case 1: return '普通用户'
      case -1: return '已封禁'
      default: return '未知'
    }
  }

  /** 通过用户名或 UUID 查找用户 */
  async resolveUserIdentifier(api, identifier) {
    const user = await api.getUserByName(identifier)
    if (user) return user.uuid
    const userList = await api.getUserList({ page: 1, page_size: 100 })
    const userById = userList.data.find(u => u.uuid === identifier)
    if (userById) return identifier
    throw new Error('未找到指定用户')
  }

  // ==================== 创建用户 ====================

  async createUser(e) {
    try {
      const params = e.msg.replace(/^#?(mcsm|MCSM)\s*(创建用户|createuser)\s*/, '').trim().split(/\s+/)
      if (params.length !== 3) {
        await e.reply('格式：\n#mcsm createuser 用户名 密码 权限\n权限值：1=用户, 10=管理员, -1=封禁')
        return false
      }
      const [username, password, permission] = params

      const api = await this.getApi(e.user_id)
      const user = await api.createUser({ username, password, permission: parseInt(permission) })
      await e.reply([
        '创建用户成功！',
        `用户名：${user.userName || username}`,
        `用户ID：${user.uuid}`,
        `权限级别：${this.getPermissionName(permission)}`
      ].join('\n'))
      return true
    } catch (error) {
      await e.reply(`创建用户失败：${error.message}`)
      return false
    }
  }

  // ==================== 删除用户 ====================

  async deleteUser(e) {
    try {
      const identifier = e.msg.replace(/^#?(mcsm|MCSM)\s*(删除用户|deleteuser)\s*/, '').trim()
      if (!identifier) { await e.reply('格式：#mcsm deleteuser <用户名或ID>'); return false }

      const api = await this.getApi(e.user_id)
      const uuid = await this.resolveUserIdentifier(api, identifier)
      await api.deleteUser(uuid)
      await e.reply('用户删除成功')
      return true
    } catch (error) {
      await e.reply(`删除用户失败：${error.message}`)
      return false
    }
  }

  // ==================== 修改权限 ====================

  async changePermission(e) {
    try {
      const params = e.msg.replace(/^#?(mcsm|MCSM)\s*(修改权限|setperm)\s*/, '').trim().split(/\s+/)
      if (params.length < 2) { await e.reply('格式：#mcsm setperm <用户名或ID> <权限值>\n权限值：1=用户, 10=管理员, -1=封禁'); return false }

      const identifier = params[0]
      const newPermission = parseInt(params[1])
      if (![1, 10, -1].includes(newPermission)) { await e.reply('无效的权限值！可选值：1(用户)、10(管理员)、-1(封禁)'); return false }

      const api = await this.getApi(e.user_id)
      const uuid = await this.resolveUserIdentifier(api, identifier)

      // 获取目标用户当前信息
      const userList = await api.getUserList({ page: 1, page_size: 100 })
      const target = userList.data.find(u => u.uuid === uuid)
      if (!target) throw new Error('目标用户不存在')

      await api.updateUser(uuid, { ...target, permission: newPermission })

      await e.reply(['修改权限成功！', `用户名：${target.userName}`, `用户ID：${uuid}`, `新权限级别：${this.getPermissionName(newPermission)}`].join('\n'))
      return true
    } catch (error) {
      await e.reply(`修改权限失败：${error.message}`)
      return false
    }
  }

  // ==================== 重置密码 ====================

  async resetPassword(e) {
    try {
      const params = e.msg.replace(/^#?(mcsm|MCSM)\s*(重置密码|resetpwd)\s*/, '').trim().split(/\s+/)
      if (params.length < 2) { await e.reply('格式：#mcsm resetpwd <用户名或ID> <新密码>\n密码长度不能小于6位'); return false }

      const identifier = params[0]
      const newPassword = params[1]
      if (newPassword.length < 6) { await e.reply('密码长度不能小于6位'); return false }

      const api = await this.getApi(e.user_id)
      const uuid = await this.resolveUserIdentifier(api, identifier)

      const userList = await api.getUserList({ page: 1, page_size: 100 })
      const target = userList.data.find(u => u.uuid === uuid)
      if (!target) throw new Error('目标用户不存在')

      await api.updateUser(uuid, { ...target, passWord: newPassword, password: newPassword })

      await e.reply(`重置密码成功！\n用户名：${target.userName}\n用户ID：${uuid}`)
      return true
    } catch (error) {
      await e.reply(`重置密码失败：${error.message}`)
      return false
    }
  }
}
