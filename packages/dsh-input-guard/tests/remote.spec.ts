import { describe, expect, it, vi } from 'vitest'
import { defaultGuardConfig, type GuardConfig } from '../src/detect.ts'
import { normalizeRemoteUrl, parseGuardConfig, parseGuardRulePayload } from '../src/config.ts'
import {
    GUARD_REMOTE_CACHE_KEY,
    fetchRemotePayload,
    mergeRemoteConfig,
    readRemoteCache,
    writeRemoteCache,
} from '../src/remote.ts'

const local = (patch: Partial<GuardConfig> = {}): GuardConfig => ({ ...defaultGuardConfig(), ...patch })
const response = (body: string, init: { ok?: boolean; status?: number; contentType?: string } = {}) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers(init.contentType === undefined ? { 'content-type': 'application/json' } : { 'content-type': init.contentType, 'content-length': String(body.length) }),
    text: async () => body,
}) as unknown as Response

function fakeStorage(initial: Record<string, string> = {}): Storage {
    const store = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size },
    } as unknown as Storage
}

describe('远程载荷解析', () => {
    it('版本不符或非对象一律拒绝', () => {
        for (const value of [null, 'text', 7, [], { version: 2 }, { version: '1' }]) {
            expect(parseGuardRulePayload(value)).toBeUndefined()
        }
    })

    it('只接受规则相关字段，越界的偏好与地址被忽略', () => {
        const payload = parseGuardRulePayload({
            version: 1,
            rules: { email: { enabled: false, action: 'mask' } },
            terms: ['客户编号'],
            termAction: 'block',
            mappings: [{ from: '喵喵', to: '茄子' }],
            // 以下三项远程无权下发。
            maskOnSubmit: false,
            maskOnPaste: false,
            remoteUrl: 'https://evil.example/rules.json',
        })
        expect(payload).toEqual({
            rules: { email: { enabled: false, action: 'mask' } },
            terms: ['客户编号'],
            termAction: 'block',
            mappings: [{ from: '喵喵', to: '茄子', enabled: true }],
        })
        expect(payload).not.toHaveProperty('maskOnSubmit')
        expect(payload).not.toHaveProperty('remoteUrl')
    })

    it('非法条目逐条丢弃，不牵连整份载荷', () => {
        const payload = parseGuardRulePayload({
            version: 1,
            rules: { email: { enabled: false, action: 'mask' }, unknown: { enabled: true, action: 'block' }, jwt: { enabled: true, action: 'nope' } },
            terms: ['ok', '', 'x'.repeat(65)],
            mappings: [{ from: '喵喵', to: '茄子' }, { from: 'same', to: 'same' }, { from: '', to: 'x' }],
        })
        expect(payload?.rules).toEqual({ email: { enabled: false, action: 'mask' } })
        expect(payload?.terms).toEqual(['ok'])
        expect(payload?.mappings).toEqual([{ from: '喵喵', to: '茄子', enabled: true }])
    })

    it('只有版本号时是合法的空载荷', () => {
        expect(parseGuardRulePayload({ version: 1 })).toEqual({})
    })
})

describe('远程优先合并', () => {
    it('rules 逐条覆盖，未提及的保留本地', () => {
        const base = local()
        const { config } = mergeRemoteConfig(base, { rules: { email: { enabled: false, action: 'block' } } })
        expect(config.rules.email).toEqual({ enabled: false, action: 'block' })
        expect(config.rules.jwt).toEqual(base.rules.jwt)
    })

    it('terms / termAction 整体替换，mappings 合到默认清单上', () => {
        const base = local({ terms: ['旧词'], mappings: [{ from: 'a', to: 'b', enabled: true }] })
        const { config } = mergeRemoteConfig(base, {
            terms: ['新词'],
            termAction: 'block',
            mappings: [{ from: '喵喵', to: '茄子', enabled: true }],
        })
        expect(config.terms).toEqual(['新词'])
        expect(config.termAction).toBe('block')
        // 远程映射以内置默认清单打底：只覆盖同名条目，默认清单不会整份消失。
        expect(config.mappings).toContainEqual({ from: '喵喵', to: '茄子', enabled: true })
        expect(config.mappings).toContainEqual({ from: '心水', to: '洋葱', enabled: true })
        expect(config.mappings.some(item => item.from === 'a')).toBe(false)
    })

    it('偏好字段与规则地址始终以本地为准', () => {
        const base = local({ maskOnSubmit: false, maskOnPaste: false, remoteUrl: 'https://local.example/rules.json' })
        const { config } = mergeRemoteConfig(base, { terms: ['新词'] })
        expect(config.maskOnSubmit).toBe(false)
        expect(config.maskOnPaste).toBe(false)
        expect(config.remoteUrl).toBe('https://local.example/rules.json')
    })

    it('拒绝会关停全部阻断规则的远程 rules，其余字段照常应用', () => {
        const base = local()
        const allOff: Record<string, { enabled: boolean; action: 'block' }> = {}
        for (const id of Object.keys(base.rules)) allOff[id] = { enabled: false, action: 'block' }
        const { config, notes } = mergeRemoteConfig(base, { rules: allOff, terms: ['新词'] })
        expect(config.rules).toEqual(base.rules)
        expect(config.terms).toEqual(['新词'])
        expect(notes.join()).toContain('阻断')
    })

    it('空载荷不改变任何字段', () => {
        const base = local({ terms: ['旧词'] })
        expect(mergeRemoteConfig(base, {}).config).toEqual(base)
        expect(mergeRemoteConfig(base, {}).notes).toEqual([])
    })
})

describe('远程规则地址', () => {
    it('只接受 https 且去掉首尾空白', () => {
        expect(normalizeRemoteUrl('  https://rules.example/g.json  ')).toBe('https://rules.example/g.json')
        for (const value of ['http://rules.example/g.json', 'ftp://x/y', '/relative', '', '   ', 42, null]) {
            expect(normalizeRemoteUrl(value)).toBeUndefined()
        }
    })

    it('本地配置里的非 https 地址被丢弃', () => {
        expect(parseGuardConfig({ version: 1, remoteUrl: 'http://x/y.json' })?.remoteUrl).toBeUndefined()
        expect(parseGuardConfig({ version: 1, remoteUrl: 'https://x/y.json' })?.remoteUrl).toBe('https://x/y.json')
        expect(parseGuardConfig({ version: 1 })?.remoteUrl).toBeUndefined()
    })
})

describe('远程拉取', () => {
    const payloadJson = JSON.stringify({ version: 1, terms: ['客户编号'] })

    it('成功时返回解析后的载荷', async () => {
        const fetchImpl = vi.fn(async () => response(payloadJson))
        await expect(fetchRemotePayload('https://rules.example/g.json', fetchImpl as unknown as typeof fetch))
            .resolves.toEqual({ terms: ['客户编号'] })
    })

    it('非 2xx、非 JSON、超长、协议不符都返回 undefined', async () => {
        await expect(fetchRemotePayload('https://x/y', (async () => response(payloadJson, { ok: false, status: 404 })) as unknown as typeof fetch)).resolves.toBeUndefined()
        await expect(fetchRemotePayload('https://x/y', (async () => response('<html>')) as unknown as typeof fetch)).resolves.toBeUndefined()
        await expect(fetchRemotePayload('https://x/y', (async () => response(JSON.stringify({ version: 1, terms: ['x'.repeat(70000)] }))) as unknown as typeof fetch)).resolves.toBeUndefined()
        await expect(fetchRemotePayload('http://x/y', (async () => response(payloadJson)) as unknown as typeof fetch)).resolves.toBeUndefined()
    })

    it('抛错与超时都不外抛', async () => {
        await expect(fetchRemotePayload('https://x/y', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).resolves.toBeUndefined()
        await expect(fetchRemotePayload('https://x/y', (async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }) as unknown as typeof fetch)).resolves.toBeUndefined()
    })
})

describe('远程缓存', () => {
    it('写入后可读回，损坏或缺失时为 undefined', () => {
        const storage = fakeStorage()
        writeRemoteCache(storage, { terms: ['客户编号'] })
        expect(readRemoteCache(storage)).toEqual({ terms: ['客户编号'] })
        expect(readRemoteCache(fakeStorage())).toBeUndefined()
        expect(readRemoteCache(fakeStorage({ [GUARD_REMOTE_CACHE_KEY]: '{坏掉的' }))).toBeUndefined()
        expect(readRemoteCache(undefined)).toBeUndefined()
    })

    it('存储写入抛错时不外抛', () => {
        const hostile = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } as unknown as Storage
        expect(() => writeRemoteCache(hostile, { terms: [] })).not.toThrow()
        expect(readRemoteCache(hostile)).toBeUndefined()
    })
})
