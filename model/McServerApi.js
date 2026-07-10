import fetch from 'node-fetch'

/**
 * Minecraft 服务器状态查询
 * 参考：https://wiki.vg/Server_List_Ping
 * 源：mctool-plugin apps/mc-utils.js 中的 queryServerStatus 和 parseServerStatus
 */

/**
 * 查询服务器状态
 * @param {string} address - 服务器地址（host:port）
 * @param {object} api - API 配置
 * @param {number} [retryCount] - 重试次数
 * @returns {Promise<object|null>}
 */
export async function queryServerStatus(address, api, retryCount = 0) {
  try {
    if (!address || !api) throw new Error('Invalid parameters')

    const [host, port = '25565'] = address.split(':')
    let url = api.url.replace('{host}', host).replace('{port}', port)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), (api.timeout || 30) * 1000)

    const options = {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }

    if (process.env.https_proxy) {
      const HttpsProxyAgent = (await import('https-proxy-agent')).default
      options.agent = new HttpsProxyAgent(process.env.https_proxy)
    }

    const response = await fetch(url, options)
    clearTimeout(timeout)

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const data = await response.json()
    const status = parseServerStatus(data, api.parser)

    if (!status) throw new Error('Failed to parse server status')

    status.api = { name: api.name, success: true, error: null }
    return status
  } catch (error) {
    logger.error(`[MCSM][McServerApi] API ${api.name} 查询失败:`, error.message)

    if (retryCount < (api.maxRetries || 3)) {
      await new Promise(resolve => setTimeout(resolve, api.retryDelay || 1000))
      return queryServerStatus(address, api, retryCount + 1)
    }

    return {
      online: false,
      players: { online: 0, max: 0, list: [] },
      version: '',
      description: '',
      timestamp: Date.now(),
      api: { name: api.name, success: false, error: error.message }
    }
  }
}

/**
 * 解析服务器状态
 * @param {object} data - API 返回的原始数据
 * @param {object} parser - 解析器配置
 * @returns {object|null}
 */
function parseServerStatus(data, parser) {
  try {
    if (!data || typeof data !== 'object') return null

    const online = getNestedValue(data, parser.online)
    if (online === undefined || online === null) return null

    const players = {
      online: getNestedValue(data, parser.players?.online) || 0,
      max: getNestedValue(data, parser.players?.max) || 0,
      list: []
    }

    const playerList = getNestedValue(data, parser.players?.list)
    if (Array.isArray(playerList)) {
      players.list = playerList.map(p => {
        if (typeof p === 'string') return { name: p, uuid: '' }
        if (typeof p === 'object' && p !== null) return { name: p.name || p.name_clean || '', uuid: p.uuid || p.id || '' }
        return null
      }).filter(p => p !== null && p.name)
    }

    return {
      online,
      players,
      version: getNestedValue(data, parser.version) || 'Unknown',
      motd: getNestedValue(data, parser.motd) || ''
    }
  } catch (error) {
    logger.error('[MCSM][McServerApi] 解析响应失败:', error)
    return null
  }
}

function getNestedValue(obj, path) {
  if (!obj || !path) return undefined
  const keys = path.replace(/\[\]$/, '').split('.')
  let value = obj
  for (const key of keys) {
    if (value === undefined || value === null) return undefined
    value = value[key]
  }
  return value
}
