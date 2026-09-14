import { describe, expect, it } from 'vitest'
import {
    addGuardMapping,
    addGuardTerm,
    GUARD_MAX_MAPPING_FROM_LENGTH,
    GUARD_MAX_MAPPING_TO_LENGTH,
    GUARD_MAX_MAPPINGS,
    GUARD_MAX_TERMS,
    GUARD_STORAGE_KEY,
    normalizeGuardMapping,
    normalizeGuardTerm,
    parseGuardConfig,
    readGuardConfig,
    removeGuardMapping,
    removeGuardTerm,
    updateGuardRule,
    writeGuardConfig,
} from '../src/config.ts'
import { DEFAULT_GUARD_MAPPINGS } from '../src/default-mappings.ts'
import { defaultGuardConfig, type GuardConfig } from '../src/detect.ts'

function fakeStorage(initial?: string): Storage {
    const store = new Map<string, string>()
    if (initial !== undefined) store.set(GUARD_STORAGE_KEY, initial)
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size },
    } as unknown as Storage
}

const raw = (patch: Record<string, unknown>): unknown => ({ version: 1, ...patch })

describe('配置解析', () => {
    it('非对象或版本不符视为整体损坏', () => {
        for (const value of [null, 'text', 42, [], { version: 2 }]) expect(parseGuardConfig(value)).toBeUndefined()
    })

    it('缺省字段回落默认值', () => {
        expect(parseGuardConfig(raw({}))).toEqual(defaultGuardConfig())
    })

    it('损坏 JSON 与空存储都回落默认配置', () => {
        expect(readGuardConfig(fakeStorage('{坏掉的'))).toEqual(defaultGuardConfig())
        expect(readGuardConfig(fakeStorage())).toEqual(defaultGuardConfig())
        expect(readGuardConfig(undefined)).toEqual(defaultGuardConfig())
    })

    it('存储读写抛错时不外抛', () => {
        const hostile = {
            getItem: () => { throw new Error('blocked') },
            setItem: () => { throw new Error('blocked') },
        } as unknown as Storage
        expect(readGuardConfig(hostile)).toEqual(defaultGuardConfig())
        expect(() => writeGuardConfig(hostile, defaultGuardConfig())).not.toThrow()
    })

    it('写入后可原样读回', () => {
        const storage = fakeStorage()
        const config: GuardConfig = { ...defaultGuardConfig(), terms: ['客户编号'], maskOnPaste: false }
        writeGuardConfig(storage, config)
        expect(readGuardConfig(storage)).toEqual(config)
    })

    it('未知规则被丢弃、单条损坏只回落该条', () => {
        const parsed = parseGuardConfig({
            version: 1,
            rules: {
                email: { enabled: false, action: 'block' },
                'unknown-rule': { enabled: true, action: 'block' },
                jwt: { enabled: 'yes', action: 'block' },
                'cn-mobile': { enabled: true, action: 'delete' },
            },
        })
        expect(parsed?.rules.email).toEqual({ enabled: false, action: 'block' })
        expect(parsed?.rules['cn-mobile']).toEqual(defaultGuardConfig().rules['cn-mobile'])
        expect(parsed?.rules).not.toHaveProperty('unknown-rule')
    })

    it('词条去空白、去重、丢弃非法项并截断到上限', () => {
        const parsed = parseGuardConfig(raw({
            terms: [' 客户编号 ', '客户编号', '', '   ', 42, 'x'.repeat(65), ...Array.from({ length: GUARD_MAX_TERMS + 5 }, (_, index) => `词条${index}`)],
        }))
        expect(parsed?.terms[0]).toBe('客户编号')
        expect(parsed?.terms).toHaveLength(GUARD_MAX_TERMS)
        expect(parsed?.terms).not.toContain('')
    })

    it('非法 termAction 回落默认值', () => {
        expect(parseGuardConfig(raw({ termAction: 'nope' }))?.termAction).toBe('mask')
    })

    it('映射非法条目被拒绝、重复 from 去重、cap 生效', () => {
        const parsed = parseGuardConfig(raw({
            mappings: [
                { from: ' 喵喵 ', to: '茄子' },
                { from: '喵喵', to: '其它' },
                { from: '', to: 'x' },
                { from: 'same', to: 'same' },
                { from: 'x'.repeat(GUARD_MAX_MAPPING_FROM_LENGTH + 1), to: 'y' },
                { from: 'long', to: 'y'.repeat(GUARD_MAX_MAPPING_TO_LENGTH + 1) },
                'nope',
                ...Array.from({ length: GUARD_MAX_MAPPINGS }, (_, index) => ({ from: `词${index}`, to: 'v' })),
            ],
        }))
        // 配置条目追加在默认清单之后（默认 41 条打底）。
        expect(parsed?.mappings).toHaveLength(GUARD_MAX_MAPPINGS)
        expect(parsed?.mappings).toEqual(expect.arrayContaining([...DEFAULT_GUARD_MAPPINGS]))
        expect(parsed?.mappings.filter(item => item.from === '喵喵')).toEqual([{ from: '喵喵', to: '茄子', enabled: true }])
    })
})

describe('映射规范化', () => {
    it('去掉首尾空白并默认启用', () => {
        expect(normalizeGuardMapping({ from: ' 喵喵 ', to: '茄子' })).toEqual({ from: '喵喵', to: '茄子', enabled: true })
        expect(normalizeGuardMapping({ from: '喵喵', to: '茄子', enabled: false })).toMatchObject({ enabled: false })
    })

    it('允许空的目标文本（等价于删除命中的词条）', () => {
        expect(normalizeGuardMapping({ from: '喵喵', to: '' })).toEqual({ from: '喵喵', to: '', enabled: true })
    })

    it.each([
        [null],
        ['text'],
        [{}],
        [{ from: '喵喵' }],
        [{ from: '', to: '茄子' }],
        [{ from: '   ', to: '茄子' }],
        [{ from: '喵喵', to: '喵喵' }],
        [{ from: 'x'.repeat(GUARD_MAX_MAPPING_FROM_LENGTH + 1), to: 'y' }],
        [{ from: 'x', to: 'y'.repeat(GUARD_MAX_MAPPING_TO_LENGTH + 1) }],
    ])('拒绝非法条目 %o', value => {
        expect(normalizeGuardMapping(value)).toBeUndefined()
    })

    it('词条规范化拒绝空串与超长', () => {
        expect(normalizeGuardTerm('  ')).toBeUndefined()
        expect(normalizeGuardTerm(7)).toBeUndefined()
        expect(normalizeGuardTerm('x'.repeat(65))).toBeUndefined()
        expect(normalizeGuardTerm(' 客户编号 ')).toBe('客户编号')
    })
})

describe('不可变编辑助手', () => {
    it('新增与删除词条返回新对象', () => {
        const base = defaultGuardConfig()
        const added = addGuardTerm(base, ' 客户编号 ')
        expect(base.terms).toEqual([])
        expect(added.terms).toEqual(['客户编号'])
        expect(addGuardTerm(added, '客户编号')).toBe(added)
        expect(addGuardTerm(added, '  ')).toBe(added)
        expect(removeGuardTerm(added, '客户编号').terms).toEqual([])
        expect(removeGuardTerm(added, '不存在')).toBe(added)
    })

    it('新增与删除映射返回新对象且拒绝重复 from', () => {
        const base = defaultGuardConfig()
        const added = addGuardMapping(base, { from: '喵喵', to: '茄子', enabled: true })
        // 默认清单打底，新增只追加。
        expect(base.mappings).toEqual([...DEFAULT_GUARD_MAPPINGS])
        expect(added.mappings).toHaveLength(DEFAULT_GUARD_MAPPINGS.length + 1)
        expect(added.mappings[added.mappings.length - 1]).toEqual({ from: '喵喵', to: '茄子', enabled: true })
        expect(addGuardMapping(added, { from: '喵喵', to: '别的', enabled: true })).toBe(added)
        expect(addGuardMapping(added, { from: '喵喵', to: '喵喵', enabled: true })).toBe(added)
        expect(removeGuardMapping(added, '喵喵').mappings).toEqual(base.mappings)
        expect(removeGuardMapping(added, '不存在')).toBe(added)
    })

    it('词条与映射数量达到上限后不再接受新增', () => {
        const terms = { ...defaultGuardConfig(), terms: Array.from({ length: GUARD_MAX_TERMS }, (_, index) => `词${index}`) }
        expect(addGuardTerm(terms, '溢出')).toBe(terms)
        const mappings = {
            ...defaultGuardConfig(),
            mappings: Array.from({ length: GUARD_MAX_MAPPINGS }, (_, index) => ({ from: `词${index}`, to: 'v', enabled: true })),
        }
        expect(addGuardMapping(mappings, { from: '溢出', to: 'v', enabled: true })).toBe(mappings)
    })

    it('更新规则只影响已知 id', () => {
        const base = defaultGuardConfig()
        expect(updateGuardRule(base, 'email', { enabled: false }).rules.email).toEqual({ enabled: false, action: 'mask' })
        expect(updateGuardRule(base, 'unknown', { enabled: false })).toBe(base)
        expect(base.rules.email).toEqual({ enabled: true, action: 'mask' })
    })
})
