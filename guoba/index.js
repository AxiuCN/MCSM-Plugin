import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_DIR = path.join(__dirname, '..')

const CONFIG_PATH = path.join(PLUGIN_DIR, 'config', 'config.yaml')
const TEMPLATE_PATH = path.join(PLUGIN_DIR, 'defSet', 'config.yaml')

// ==================== 默认值 ====================

function getDefaults() {
  return {
    restart_enableMcsm: true,
    restart_mcsmHost: '127.0.0.1',
    restart_mcsmPort: 23333,
    restart_mcsmApiKey: '',
    restart_mcsmInstanceUuid: '',
    restart_mcsmDaemonId: '',
    restart_restartCron: ''
  }
}

function getSchema() {
  return [
    { label: '重启管理', component: 'SOFT_GROUP_BEGIN' },
    { field: 'restart.enableMcsm', label: '启用MCSM面板重启', bottomHelpMessage: '关闭则使用框架原生重启', component: 'Switch', defaultValue: true },
    { field: 'restart.mcsmHost', label: 'MCSM面板地址', component: 'Input', defaultValue: '127.0.0.1', componentProps: { placeholder: '127.0.0.1' } },
    { field: 'restart.mcsmPort', label: 'MCSM面板端口', component: 'InputNumber', defaultValue: 23333, componentProps: { min: 1, max: 65535, step: 1 } },
    { field: 'restart.mcsmApiKey', label: 'API Key', component: 'Input', componentProps: { placeholder: 'MCSManager 面板 API Key' } },
    { field: 'restart.mcsmInstanceUuid', label: '实例UUID', component: 'Input', componentProps: { placeholder: 'MCSManager 实例 UUID' } },
    { field: 'restart.mcsmDaemonId', label: '守护进程ID', component: 'Input', componentProps: { placeholder: 'MCSManager 守护进程 ID' } },
    { field: 'restart.restartCron', label: '定时重启Cron', bottomHelpMessage: '每行一个cron表达式，留空不执行定时任务', component: 'Input', componentProps: { type: 'textarea', placeholder: '0 4 * * *\n0 12 * * *', rows: 3 } },

    { label: '绑定管理', component: 'SOFT_GROUP_BEGIN' },
    { field: 'bind.dataDir', label: '用户数据目录', bottomHelpMessage: '留空使用默认路径', component: 'Input', defaultValue: '' }
  ]
}

// ==================== 工具函数 ====================

function generateConfig(templatePath, values) {
  const template = fs.readFileSync(templatePath, 'utf8')
  return template.replace(/\$\{(\w+)\}/g, (_, name) => {
    if (name in values) {
      const val = values[name]
      return val == null ? '' : String(val)
    }
    return ''
  })
}

function parseCron(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(item => item.cron || item).filter(Boolean)
  return String(raw).split('\n').map(s => s.trim()).filter(Boolean)
}

function cronToTemplateValue(arr) {
  if (!arr.length) return '[]'
  return '\n' + arr.map(c => `    - "${c}"`).join('\n')
}

// ==================== 导出 ====================

export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'MCSM-Plugin',
      title: 'MCSManager管理',
      author: '@阿修Axiu',
      isV3: true,
      isV2: false,
      description: 'MCSManager面板管理 + Minecraft服务器管理',
      icon: 'mdi:server',
      iconColor: '#1677ff'
    },

    configInfo: {
      schemas: getSchema(),

      getConfigData() {
        let restart = {}
        try {
          if (fs.existsSync(CONFIG_PATH)) {
            const raw = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}
            restart = raw.restart || {}
          }
        } catch (err) {
          logger.error('[MCSM][Guoba] 读取配置失败:', err)
        }

        const cronArr = restart.restartCron || []
        const cronText = Array.isArray(cronArr) ? cronArr.join('\n') : String(cronArr)

        return {
          'restart.enableMcsm': restart.enableMcsm ?? true,
          'restart.mcsmHost': restart.mcsmHost ?? '127.0.0.1',
          'restart.mcsmPort': restart.mcsmPort ?? 23333,
          'restart.mcsmApiKey': restart.mcsmApiKey ?? '',
          'restart.mcsmInstanceUuid': restart.mcsmInstanceUuid ?? '',
          'restart.mcsmDaemonId': restart.mcsmDaemonId ?? '',
          'restart.restartCron': cronText
        }
      },

      async setConfigData(data, { Result }) {
        try {
          const configDir = path.join(PLUGIN_DIR, 'config')
          if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

          const restartCronArr = parseCron(data['restart.restartCron'])

          const values = {
            restart_enableMcsm: data['restart.enableMcsm'] ?? true,
            restart_mcsmHost: data['restart.mcsmHost'] || '127.0.0.1',
            restart_mcsmPort: data['restart.mcsmPort'] ?? 23333,
            restart_mcsmApiKey: data['restart.mcsmApiKey'] || '',
            restart_mcsmInstanceUuid: data['restart.mcsmInstanceUuid'] || '',
            restart_mcsmDaemonId: data['restart.mcsmDaemonId'] || '',
            restart_restartCron: cronToTemplateValue(restartCronArr)
          }

          const content = generateConfig(TEMPLATE_PATH, values)
          fs.writeFileSync(CONFIG_PATH, content, 'utf8')

          return Result.ok({}, '保存成功~')
        } catch (err) {
          logger.error('[MCSM][Guoba] 保存配置失败:', err)
          return Result.error(`保存失败：${err.message}`)
        }
      }
    }
  }
}
