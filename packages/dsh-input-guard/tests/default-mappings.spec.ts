import { describe, expect, it } from 'vitest'
import {
    GUARD_MAX_MAPPING_FROM_LENGTH,
    GUARD_MAX_MAPPING_TO_LENGTH,
    GUARD_MAX_MAPPINGS,
    mergeDefaultMappings,
    normalizeGuardMapping,
    parseGuardConfig,
} from '../src/config.ts'
import { DEFAULT_GUARD_MAPPINGS } from '../src/default-mappings.ts'
import { defaultGuardConfig, guard, substitute } from '../src/detect.ts'
import { mergeRemoteConfig } from '../src/remote.ts'

/** 取同名条目，便于断言「唯一且已被覆盖」。 */
const byFrom = (list: readonly { from: string; to: string }[], from: string): { from: string; to: string }[] =>
    list.filter(item => item.from === from)

describe('内置默认映射清单', () => {
    it('去重后 41 条，from 唯一且都有不同目标', () => {
        expect(DEFAULT_GUARD_MAPPINGS).toHaveLength(41)
        const froms = DEFAULT_GUARD_MAPPINGS.map(mapping => mapping.from)
        expect(new Set(froms).size).toBe(froms.length)
        expect(DEFAULT_GUARD_MAPPINGS.filter(mapping => mapping.from === mapping.to)).toEqual([])
    })

    it('每条都通过规范化校验（长度、空值、启用状态）', () => {
        for (const mapping of DEFAULT_GUARD_MAPPINGS) {
            expect(normalizeGuardMapping(mapping)).toEqual(mapping)
            expect(mapping.from.length).toBeLessThanOrEqual(GUARD_MAX_MAPPING_FROM_LENGTH)
            expect(mapping.to.length).toBeLessThanOrEqual(GUARD_MAX_MAPPING_TO_LENGTH)
            expect(mapping.enabled).toBe(true)
        }
    })

    it('默认配置带上整份清单，且返回副本而非共享数组', () => {
        const config = defaultGuardConfig()
        expect(config.mappings).toEqual([...DEFAULT_GUARD_MAPPINGS])
        expect(config.mappings).not.toBe(DEFAULT_GUARD_MAPPINGS)
    })
})

describe('默认映射打底', () => {
    it('配置未声明 mappings 时使用默认清单', () => {
        expect(parseGuardConfig({ version: 1 })?.mappings).toEqual([...DEFAULT_GUARD_MAPPINGS])
    })

    it('配置里非数组的 mappings 回落默认清单', () => {
        expect(parseGuardConfig({ version: 1, mappings: 'nope' })?.mappings).toEqual([...DEFAULT_GUARD_MAPPINGS])
    })

    it('同名 from 以配置为准，可改目标', () => {
        const merged = mergeDefaultMappings([{ from: '倒数321', to: '南瓜', enabled: true }])
        expect(merged).toHaveLength(DEFAULT_GUARD_MAPPINGS.length)
        expect(byFrom(merged, '倒数321')).toEqual([{ from: '倒数321', to: '南瓜', enabled: true }])
    })

    it('同名 from 可禁用某条默认映射', () => {
        const merged = mergeDefaultMappings([{ from: '心水', to: '洋葱', enabled: false }])
        expect(byFrom(merged, '心水')).toEqual([{ from: '心水', to: '洋葱', enabled: false }])
    })

    it('新增条目追加在后，不挤掉默认清单', () => {
        const merged = mergeDefaultMappings([{ from: '新词', to: '新值', enabled: true }])
        expect(merged).toHaveLength(DEFAULT_GUARD_MAPPINGS.length + 1)
        expect(merged[merged.length - 1]).toEqual({ from: '新词', to: '新值', enabled: true })
    })

    it('总数仍受上限约束', () => {
        const extras = Array.from({ length: GUARD_MAX_MAPPINGS }, (_, index) => ({ from: `词${index}`, to: 'v', enabled: true }))
        expect(mergeDefaultMappings(extras)).toHaveLength(GUARD_MAX_MAPPINGS)
    })

    it('远程下发的映射同样以默认清单打底', () => {
        const { config } = mergeRemoteConfig(defaultGuardConfig(), {
            mappings: [{ from: '倒数321', to: '南瓜', enabled: true }],
        })
        expect(config.mappings).toHaveLength(DEFAULT_GUARD_MAPPINGS.length)
        expect(byFrom(config.mappings, '倒数321')).toEqual([{ from: '倒数321', to: '南瓜', enabled: true }])
        expect(byFrom(config.mappings, '心水')).toHaveLength(1)
    })
})

describe('默认映射的替换效果', () => {
    it('产品名被改写为代号', () => {
        const result = substitute('喵喵记账好用吗', defaultGuardConfig())
        expect(result.text).toBe('兰花好用吗')
        expect(result.substitutions).toHaveLength(1)
    })

    it('存在包含关系时长词优先，不会被拆成短词', () => {
        expect(substitute('心水收纳 和 心水', defaultGuardConfig()).text).toBe('芹菜 和 洋葱')
        expect(substitute('可乐记账-鸿蒙 与 可乐记账', defaultGuardConfig()).text).toBe('海棠 与 海棠')
        expect(substitute('阿柴记账-海外 与 阿柴记账', defaultGuardConfig()).text).toBe('牡丹 与 牡丹')
    })

    it('走完整 guard 时是静默改写，不产生告警', () => {
        expect(guard('帮我看看 清单盒子', defaultGuardConfig())).toEqual({
            kind: 'rewrite',
            text: '帮我看看 兔子',
            findings: [],
            substitutions: [{ from: '清单盒子', to: '兔子', start: 5, end: 9 }],
            reason: 'mapping',
        })
    })
})
