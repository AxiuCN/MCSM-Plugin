/**
 * MCSManager 面板 HTTP API 封装
 *
 * 双模式：
 *   1. 纯函数 export — Bot 自身重启（无需用户绑定，配置来自 config.yaml）
 *   2. Class export — 用户操作（需绑定面板，构造函数接收 { host, port, apiKey }）
 *
 * API 约定（参考 .claude/mcsm-docs/apis/get_apikey.md）：
 *   - API Key 作为 URL Query 参数 apikey=xxx
 *   - 所有请求带 X-Requested-With: XMLHttpRequest
 *   - POST/PUT 请求额外带 Content-Type: application/json; charset=utf-8
 *   - 返回 { status: 200, data: ..., time: ... }，status ≠ 200 为错误
 */

/**
 * 调用 MCSManager 重启接口（Bot 自身重启用）
 * @param {object} params
 * @param {string} params.host
 * @param {number} params.port
 * @param {string} params.apiKey
 * @param {string} params.instanceUuid
 * @param {string} params.daemonId
 * @returns {Promise<{success: boolean, status?: number, error?: string}>}
 */
export async function restartInstance({ host, port, apiKey, instanceUuid, daemonId }) {
  const query = new URLSearchParams({
    uuid: instanceUuid,
    daemonId,
    apikey: apiKey
  })

  const url = `http://${host}:${port}/api/protected_instance/restart?${query}`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json; charset=utf-8'
      }
    })

    const body = await res.json().catch(() => null)
    const status = body?.status ?? res.status

    if (status === 200) {
      return { success: true, status }
    }
    return { success: false, status, error: `MCSM 返回状态码 ${status}` }

  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * MCSManager API 客户端（用户操作）
 */
export default class McsmApi {
  /**
   * @param {object} config - { host, port, apiKey }
   */
  constructor({ host, port, apiKey }) {
    this.host = host
    this.port = port
    this.apiKey = apiKey
    this.baseUrl = `http://${host}:${port}`
  }

  /** 构建带 API Key 的 URL */
  buildUrl(path) {
    const url = new URL(path, this.baseUrl)
    url.searchParams.append('apikey', this.apiKey)
    return url.toString()
  }

  /** 获取请求头 */
  getHeaders() {
    return {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json; charset=utf-8'
    }
  }

  /** 统一处理 API 响应 */
  async handleResponse(response) {
    const responseText = await response.text()
    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch {
      throw new Error('服务器响应格式错误')
    }

    if (responseData.status === 500) {
      throw new Error(responseData.data || '操作失败')
    }
    if (!response.ok) {
      throw new Error(responseData.error || this._httpErrorMessage(response.status))
    }
    if (responseData.status !== 200) {
      throw new Error(responseData.error || '面板返回错误状态')
    }
    return responseData.data
  }

  _httpErrorMessage(status) {
    const msgs = { 400: '请求参数错误', 401: '未授权，请检查API密钥', 403: '权限不足', 404: '资源不存在', 500: '服务器内部错误', 502: '网关错误', 503: '服务不可用', 504: '网关超时' }
    return msgs[status] || `HTTP错误 ${status}`
  }

  // ==================== 面板概览 ====================

  async getOverview() {
    const url = this.buildUrl('/api/overview')
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  // ==================== 实例管理 ====================

  async getInstanceList(params = {}) {
    const query = new URLSearchParams({
      daemonId: params.daemonId || '',
      page: params.page || 1,
      page_size: params.page_size || 50,
      instance_name: params.instance_name || '',
      status: params.status || ''
    })
    const url = this.buildUrl(`/api/service/remote_service_instances?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  async getInstanceInfo(uuid, daemonId) {
    const query = new URLSearchParams({ uuid, daemonId })
    const url = this.buildUrl(`/api/instance?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  /**
   * 实例操作
   * @param {string} uuid - 实例 UUID
   * @param {string} op - open | stop | restart | kill
   * @param {string} daemonId - 守护进程 ID
   */
  async instanceOperation(uuid, op, daemonId) {
    const query = new URLSearchParams({ uuid, daemonId })
    const url = this.buildUrl(`/api/protected_instance/${op}?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  async getInstanceLog(uuid, daemonId, size) {
    const query = new URLSearchParams({ uuid, daemonId })
    if (size) query.append('size', String(size))
    const url = this.buildUrl(`/api/protected_instance/outputlog?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  async sendCommand(uuid, daemonId, command) {
    const query = new URLSearchParams({ uuid, daemonId, command })
    const url = this.buildUrl(`/api/protected_instance/command?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  // ==================== 用户管理 ====================

  async getUserList(params = {}) {
    const query = new URLSearchParams({
      userName: params.userName || '',
      page: params.page || 1,
      page_size: params.page_size || 20,
      role: params.role || ''
    })
    const url = this.buildUrl(`/api/auth/search?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  async createUser({ username, password, permission }) {
    const url = this.buildUrl('/api/auth')
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ username, password, permission })
    })
    return this.handleResponse(res)
  }

  async updateUser(uuid, config) {
    const url = this.buildUrl('/api/auth')
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ uuid, config })
    })
    return this.handleResponse(res)
  }

  async deleteUser(uuid) {
    const url = this.buildUrl('/api/auth')
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify([uuid])
    })
    return this.handleResponse(res)
  }

  async getUserByName(userName) {
    const userList = await this.getUserList({ page: 1, page_size: 100, userName })
    const user = userList.data.find(u => u.userName === userName)
    return user || null
  }

  // ==================== 守护进程/节点管理 ====================

  async getDaemonList() {
    const url = this.buildUrl('/api/service/remote_services')
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  async addDaemonNode({ ip, port, apiKey, remarks, prefix }) {
    const url = this.buildUrl('/api/service/remote_service')
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ip, port, apiKey, remarks: remarks || '', prefix: prefix || '' })
    })
    return this.handleResponse(res)
  }

  async deleteDaemonNode(uuid) {
    const query = new URLSearchParams({ uuid })
    const url = this.buildUrl(`/api/service/remote_service?${query}`)
    const res = await fetch(url, { method: 'DELETE', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  async linkDaemonNode(uuid) {
    const query = new URLSearchParams({ uuid })
    const url = this.buildUrl(`/api/service/link_remote_service?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  // ==================== 文件管理 ====================

  async getFileList(daemonId, uuid, target = '/', page = 0, pageSize = 100) {
    const query = new URLSearchParams({
      daemonId,
      uuid,
      target,
      file_name: '',
      page,
      page_size: pageSize
    })
    const url = this.buildUrl(`/api/files/list?${query}`)
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  async getFileDownloadConfig(daemonId, uuid, fileName) {
    const query = new URLSearchParams({ file_name: fileName, daemonId, uuid })
    const url = this.buildUrl(`/api/files/download?${query}`)
    const res = await fetch(url, { method: 'POST', headers: this.getHeaders() })
    return this.handleResponse(res)
  }

  /**
   * 下载文件到本地
   * @param {string} addr - 节点地址
   * @param {string} password - 下载密码
   * @param {string} fileName - 文件名
   * @param {string} savePath - 本地保存路径
   */
  async downloadFile(addr, password, fileName, savePath) {
    let baseUrl = addr
    if (addr.startsWith('ws://')) baseUrl = addr.replace('ws://', 'http://')
    else if (addr.startsWith('ws')) baseUrl = addr.replace('ws', 'http://')
    else if (!addr.startsWith('http://') && !addr.startsWith('https://')) baseUrl = `http://${addr}`

    const url = `${baseUrl}/download/${password}/${encodeURIComponent(fileName)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败: ${res.status} ${res.statusText}`)

    const { createWriteStream } = await import('node:fs')
    const { pipeline } = await import('node:stream/promises')
    const fileStream = createWriteStream(savePath)
    await pipeline(res.body, fileStream)
  }
}
