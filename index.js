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

let ret = []
if (files) {
  files.forEach(file => {
    if (file.endsWith('.js')) {
      ret.push(import(`./apps/${file}?t=${Date.now()}`))
    }
  })
}

ret = await Promise.allSettled(ret)

for (let i in files) {
  const name = files[i].replace('.js', '')

  if (ret[i].status !== 'fulfilled') {
    logger.error(`[MCSM] 载入插件错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  const mod = ret[i].value
  apps[name] = mod[Object.keys(mod)[0]]
}

logger.info(`[MCSM] 插件加载完成，共 ${Object.keys(apps).length} 个模块`)

export { apps }
