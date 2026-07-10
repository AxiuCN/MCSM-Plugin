import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))

export const pluginVersion = pkg.version

export const yunzaiVersion = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf-8')).version
  } catch {
    return 'unknown'
  }
})()
