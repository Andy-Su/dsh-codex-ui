// 构建后契约断言：banner id 必须与包名一致，且 require() 只允许宿主提供的模块。
// 这两个条件错了，bundle 在浏览器里会静默加载失败或引入第二份 React。
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const allowedRequires = new Set(['react', 'react-dom', 'react/jsx-runtime'])

for (const artifact of ['lib/index.mjs', 'lib/index.d.mts', 'lib/client.js']) {
  assert.ok(existsSync(new URL(artifact, root)), `缺少构建产物 ${artifact}`)
}

const client = readFileSync(new URL('lib/client.js', root), 'utf8')
const flat = client.replace(/\s+/g, ' ').trim()
assert.ok(
  flat.startsWith(`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`),
  `bundle 头部必须按 ModuleLoader 约定声明包名 ${manifest.name}`,
)
assert.ok(flat.endsWith('return module.exports; } });'), 'bundle 尾部必须闭合 ModuleLoader 工厂')

const requested = new Set([...client.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]))
for (const name of requested) {
  assert.ok(allowedRequires.has(name), `bundle 只允许 require 宿主模块，出现 ${name}`)
}

const host = readFileSync(new URL('lib/index.mjs', root), 'utf8')
assert.ok(!host.includes('__ModuleLoader__'), 'Host 半边不得包含浏览器加载器代码')

console.log(`bundle 契约通过：${manifest.name}，外部依赖 ${requested.size === 0 ? '无' : [...requested].join(', ')}，产物目录 ${fileURLToPath(new URL('lib/', root))}`)
