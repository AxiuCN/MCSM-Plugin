import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { ConfigManager } from './components/ConfigManager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 初始化配置管理器
ConfigManager.init(__dirname)

const apps = {}
const appsDir = path.join(__dirname, 'apps')
const files = (await fs.readdir(appsDir)).filter(f => f.endsWith('.js'))

await Promise.allSettled(
  files.map(async file => {
    try {
      const mod = await import(`./apps/${file}?t=${Date.now()}`)
      apps[file.replace('.js', '')] = mod
    } catch (err) {
      logger.error(`[MCSM] 加载 apps/${file} 失败:`, err.message)
    }
  })
)

logger.info(`[MCSM] 插件加载完成，共 ${Object.keys(apps).length} 个模块`)

export { apps }
