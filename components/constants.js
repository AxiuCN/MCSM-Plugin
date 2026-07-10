import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 日志前缀 */
export const LOG_PREFIX = '[MCSM]'

/** 重启上下文 Redis 键 */
export const REDIS_KEY_RESTART = 'Yz:mcsm:restart'

/** 用户数据目录 */
export const DATA_DIR = path.join(__dirname, '..', 'data', 'MCSM-Plugin')

/** 默认重启配置 */
export const DEFAULT_RESTART_CONFIG = {
  restart: {
    enableMcsm: true,
    mcsmHost: '127.0.0.1',
    mcsmPort: 23333,
    mcsmApiKey: '',
    mcsmInstanceUuid: '',
    mcsmDaemonId: '',
    restartCron: []
  }
}
