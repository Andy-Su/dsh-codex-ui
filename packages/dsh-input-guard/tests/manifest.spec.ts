import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GUARD_RULE_IDS } from '../src/rules.ts'
import { en, zh } from '../src/locales.ts'
import { inject } from '../src/client/index.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const manifest = JSON.parse(read('../package.json')) as Record<string, any>
const patch = read('../cordis.patch.yml')

describe('清单契约', () => {
    it('入口与类型声明指向构建产物', () => {
        expect(manifest.name).toBe('@michengai/dsh-input-guard')
        expect(manifest.private).toBe(false)
        expect(manifest.type).toBe('module')
        expect(manifest.main).toBe('lib/index.mjs')
        expect(manifest.types).toBe('lib/index.d.mts')
        expect(manifest.exports['.'].types).toBe('./lib/index.d.mts')
        expect(manifest.exports['.'].default).toBe('./lib/index.mjs')
        expect(manifest.exports['./client'].default).toBe('./lib/client.js')
    })

    it('发布物包含构建产物与补丁文件', () => {
        for (const entry of ['lib', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE']) {
            expect(manifest.files).toContain(entry)
        }
    })

    it('无运行时依赖，宿主能力全部走 peerDependencies', () => {
        expect(manifest.dependencies).toBeUndefined()
        for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', 'react', 'react-dom']) {
            expect(Object.keys(manifest.peerDependencies)).toContain(name)
        }
    })

    it('客户端半边声明 web 平台与最小注入面', () => {
        expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
        expect(manifest.dsh.client.platform).toBe('web')
        const expected = [
            '@deepseek-ai/dsh-client-runtime',
            '@deepseek-ai/dsh-client-locale',
            '@deepseek-ai/dsh-client-ui-conversation',
            '@deepseek-ai/dsh-client-ui-input-trigger',
        ]
        expect(manifest.dsh.client.inject).toEqual(expected)
        // 类型用包不得进入注入白名单，否则会在加载期被当成缺失服务。
        expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-slots')
        expect([...inject].sort()).toEqual(['conversation', 'inputTriggers', 'locale', 'sessions', 'slots'].sort())
    })

    it('补丁行与包名一致', () => {
        expect(patch).toContain('insert:')
        expect(patch).toMatch(/id: input-guard/)
        expect(patch).toContain(`name: '${manifest.name}'`)
    })

    it('引擎与脚本自足', () => {
        expect(manifest.engines.node).toBe('^22.19.0 || >=24.0.0')
        expect(manifest.scripts.typecheck).toBe('tsc --noEmit -p tsconfig.json')
        expect(manifest.scripts.test).toContain('pnpm run typecheck')
        expect(manifest.scripts.test).toContain('vitest run')
        expect(manifest.scripts.test).toContain('tsdown')
        expect(manifest.scripts.test).toContain('node tests/bundle.assert.mjs')
    })
})

describe('词典契约', () => {
    it('中英键一一对应', () => {
        expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    })

    it('每条规则都有中英标签，且模板占位符一致', () => {
        for (const ruleId of GUARD_RULE_IDS) {
            const key = `guard.rule.${ruleId}`
            expect(dict(zh)).toHaveProperty(key)
            expect(dict(en)).toHaveProperty(key)
        }
        expect(dict(zh)['guard.blocked']).toContain('{rules}')
        expect(dict(en)['guard.blocked']).toContain('{rules}')
    })

    it('映射路径不提供提示文案（静默改写）', () => {
        for (const key of Object.keys(zh)) expect(key).not.toContain('guard.mapped')
    })
})

function dict(source: object): Record<string, string> {
    return source as Record<string, string>
}
