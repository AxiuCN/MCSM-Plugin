import fs from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { DATA_DIR, DEFAULT_RESTART_CONFIG } from './constants.js'

/**
 * MCSM-Plugin 统一数据管理（YAML 分片存储）
 *
 * 用户绑定数据：data/MCSM-Plugin/{QQ}.yaml（每个 QQ 一个独立文件）
 * MC 服务器配置：config/mc-server.yaml
 * 重启配置：config/config.yaml → restart 段
 *
 * 所有持久化读写必须通过此模块，不直接读写文件。
 */
let pluginRoot = ''

export const ConfigManager = {
  /** @param {string} root - 插件根目录 */
  init(root) {
    pluginRoot = root
    this._ensureDataDir()
  },

  // ==================== 用户绑定（YAML 分片）====================

  _userFilePath(qq) {
    return path.join(DATA_DIR, `${qq}.yaml`)
  },

  _ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }
  },

  /**
   * 读取单个用户的绑定数据
   * @param {string} qq
   * @returns {Promise<object|null>}
   */
  async getUserBind(qq) {
    try {
      const fp = this._userFilePath(qq)
      const stat = await fs.stat(fp).catch(() => null)
      if (!stat) return null
      const raw = await fs.readFile(fp, 'utf-8')
      return YAML.parse(raw) || null
    } catch (err) {
      logger.error(`[MCSM][ConfigManager] 读取用户 ${qq} 绑定数据失败:`, err)
      return null
    }
  },

  /**
   * 保存单个用户的绑定数据
   * @param {string} qq
   * @param {object} data
   */
  async saveUserBind(qq, data) {
    try {
      this._ensureDataDir()
      const fp = this._userFilePath(qq)
      await fs.writeFile(fp, YAML.stringify(data), 'utf-8')
    } catch (err) {
      logger.error(`[MCSM][ConfigManager] 保存用户 ${qq} 绑定数据失败:`, err)
    }
  },

  /**
   * 绑定/更新面板
   * @param {string} qq
   * @param {object} panelData - { host, port, apiKey, alias, defaultDaemon, defaultInstance }
   */
  async bindPanel(qq, panelData) {
    let data = await this.getUserBind(qq)
    if (!data) {
      data = { qq, bindTime: Date.now(), panels: [] }
    }
    data.bindTime = Date.now()

    // 检查是否已绑定同一面板（相同 host+port），有则更新，否则追加
    const idx = data.panels.findIndex(p => p.host === panelData.host && p.port === panelData.port)
    if (idx >= 0) {
      data.panels[idx] = { ...data.panels[idx], ...panelData }
    } else {
      data.panels.push({
        host: panelData.host || '',
        port: panelData.port || 23333,
        apiKey: panelData.apiKey || '',
        alias: panelData.alias || '',
        defaultDaemon: panelData.defaultDaemon || '',
        defaultInstance: panelData.defaultInstance || ''
      })
    }
    await this.saveUserBind(qq, data)
    return data
  },

  /**
   * 删除指定面板绑定
   * @param {string} qq
   * @param {number} panelIndex
   */
  async unbindPanel(qq, panelIndex) {
    const data = await this.getUserBind(qq)
    if (!data || !data.panels) return null
    data.panels.splice(panelIndex, 1)
    await this.saveUserBind(qq, data)
    return data
  },

  /**
   * 获取当前活跃面板配置（默认返回第一个面板）
   * @param {string} qq
   * @returns {Promise<{host: string, port: number, apiKey: string}|null>}
   */
  async getActivePanel(qq) {
    const data = await this.getUserBind(qq)
    if (!data?.panels?.length) return null
    return data.panels[0]
  },

  /** 列出所有绑定的用户 */
  async getAllBoundUsers() {
    try {
      this._ensureDataDir()
      const files = await fs.readdir(DATA_DIR)
      const results = []
      for (const f of files) {
        if (!f.endsWith('.yaml')) continue
        const fp = path.join(DATA_DIR, f)
        const raw = await fs.readFile(fp, 'utf-8')
        const data = YAML.parse(raw)
        if (data) results.push(data)
      }
      return results
    } catch (err) {
      logger.error('[MCSM][ConfigManager] 列出绑定用户失败:', err)
      return []
    }
  },

  // ==================== MC 服务器配置 ====================

  _mcServerPath() {
    return path.join(pluginRoot, 'config', 'mc-server.yaml')
  },

  async getMcServers() {
    try {
      const fp = this._mcServerPath()
      const stat = await fs.stat(fp).catch(() => null)
      if (!stat) return []
      const raw = await fs.readFile(fp, 'utf-8')
      const data = YAML.parse(raw) || {}
      return data.servers || []
    } catch (err) {
      logger.error('[MCSM][ConfigManager] 读取 MC 服务器配置失败:', err)
      return []
    }
  },

  async addMcServer(serverData) {
    const servers = await this.getMcServers()
    servers.push({
      name: serverData.name || '',
      host: serverData.host || '',
      port: serverData.port || 25565,
      type: serverData.type || 'java',
      description: serverData.description || '',
      addTime: Date.now()
    })
    await fs.mkdir(path.dirname(this._mcServerPath()), { recursive: true }).catch(() => {})
    await fs.writeFile(this._mcServerPath(), YAML.stringify({ servers }), 'utf-8')
    return servers
  },

  async deleteMcServer(index) {
    const servers = await this.getMcServers()
    if (index < 0 || index >= servers.length) return servers
    servers.splice(index, 1)
    await fs.writeFile(this._mcServerPath(), YAML.stringify({ servers }), 'utf-8')
    return servers
  },

  // ==================== Bot 重启配置 ====================

  /**
   * 加载重启配置
   * 优先级：config/config.yaml > config/config.yaml.example > 硬编码默认值
   * 首次启动时自动从 .example 复制到 config.yaml
   * @returns {object} restart 配置对象
   */
  getRestartConfig() {
    const configPath = path.join(pluginRoot, 'config', 'config.yaml')
    const examplePath = path.join(pluginRoot, 'config', 'config.yaml.example')

    if (existsSync(configPath)) {
      try {
        const raw = YAML.parse(readFileSync(configPath, 'utf8')) || {}
        return raw.restart || DEFAULT_RESTART_CONFIG.restart
      } catch (err) {
        logger.error('[MCSM][ConfigManager] 解析 config.yaml 失败:', err)
        return DEFAULT_RESTART_CONFIG.restart
      }
    }

    if (existsSync(examplePath)) {
      try {
        const dir = path.dirname(configPath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        copyFileSync(examplePath, configPath)
        logger.info('[MCSM] 已从 .example 创建 config.yaml，请按需修改')
        const raw = YAML.parse(readFileSync(examplePath, 'utf8')) || {}
        return raw.restart || DEFAULT_RESTART_CONFIG.restart
      } catch (err) {
        logger.error('[MCSM][ConfigManager] 从 .example 复制配置失败:', err)
        return DEFAULT_RESTART_CONFIG.restart
      }
    }

    logger.warn('[MCSM] 无配置文件，使用默认重启配置')
    return DEFAULT_RESTART_CONFIG.restart
  }
}
