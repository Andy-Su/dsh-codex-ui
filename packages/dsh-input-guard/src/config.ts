/**
 * 配置解析与持久化。
 *
 * 事实源是浏览器 localStorage 的版本化键；解析严格校验、失败回落默认值，
 * 读写异常一律吞掉，保证过滤功能不会阻塞输入。
 *
 * 版本策略：新增字段（terms / mappings 等）保持 version 1 的可选字段，
 * 这样旧版本读到未知字段只会忽略、下次写入时丢掉该字段，不会连带回落全部配置。
 */
import { DEFAULT_GUARD_MAPPINGS } from './default-mappings.ts'
import { defaultGuardConfig, type GuardConfig, type GuardMapping, type GuardRuleSetting } from './detect.ts'
import { hasGuardRule } from './rules.ts'

export const GUARD_STORAGE_KEY = 'michengai.codex-ui.input-guard.v1'
export const GUARD_CONFIG_VERSION = 1
export const GUARD_MAX_TERMS = 200
export const GUARD_MAX_TERM_LENGTH = 64
export const GUARD_MAX_MAPPINGS = 200
export const GUARD_MAX_MAPPING_FROM_LENGTH = 64
export const GUARD_MAX_MAPPING_TO_LENGTH = 256

function parseAction(value: unknown): GuardRuleSetting['action'] | undefined {
    return value === 'block' || value === 'mask' ? value : undefined
}

function parseRuleSetting(id: string, value: unknown): GuardRuleSetting | undefined {
    if (!hasGuardRule(id)) return undefined
    if (value === null || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    const action = parseAction(record.action)
    if (action === undefined || typeof record.enabled !== 'boolean') return undefined
    return { enabled: record.enabled, action }
}

/** 词条规范化：去空白、限制长度；非法输入返回 undefined。 */
export function normalizeGuardTerm(term: unknown): string | undefined {
    if (typeof term !== 'string') return undefined
    const trimmed = term.trim()
    if (trimmed === '' || trimmed.length > GUARD_MAX_TERM_LENGTH) return undefined
    return trimmed
}

/**
 * 映射规范化：`from` 去空白并限长，`to` 可为空字符串（表示删除命中词条）。
 * `from === to` 视为无意义配置，直接拒绝。
 */
export function normalizeGuardMapping(value: unknown): GuardMapping | undefined {
    if (value === null || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    if (typeof record.from !== 'string' || typeof record.to !== 'string') return undefined
    const from = record.from.trim()
    if (from === '' || from.length > GUARD_MAX_MAPPING_FROM_LENGTH) return undefined
    if (record.to.length > GUARD_MAX_MAPPING_TO_LENGTH || from === record.to) return undefined
    return { from, to: record.to, enabled: record.enabled !== false }
}

function parseTerms(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    const terms: string[] = []
    for (const entry of value) {
        const term = normalizeGuardTerm(entry)
        if (term === undefined || terms.includes(term)) continue
        if (terms.length >= GUARD_MAX_TERMS) break
        terms.push(term)
    }
    return terms
}

function parseMappingList(value: unknown): GuardMapping[] {
    if (!Array.isArray(value)) return []
    const mappings: GuardMapping[] = []
    for (const entry of value) {
        const mapping = normalizeGuardMapping(entry)
        if (mapping === undefined || mappings.some(item => item.from === mapping.from)) continue
        if (mappings.length >= GUARD_MAX_MAPPINGS) break
        mappings.push(mapping)
    }
    return mappings
}

/**
 * 把一组映射合到内置默认映射之上：同名 `from` 以传入的为准（可改目标或用 `enabled: false` 禁用），
 * 新增条目追加在后，总数仍受 `GUARD_MAX_MAPPINGS` 限制。
 *
 * 采用「默认打底」而不是「整体替换」：内置清单是基础防线，不该因为配置里写了别的条目就整份消失；
 * 要禁用某条默认映射，写同名条目并置 `enabled: false` 即可。
 */
export function mergeDefaultMappings(configured: readonly GuardMapping[]): GuardMapping[] {
    const overrides = new Map(configured.map(mapping => [mapping.from, mapping]))
    const defaults = DEFAULT_GUARD_MAPPINGS.map(mapping => overrides.get(mapping.from) ?? mapping)
    const defaultFroms = new Set(DEFAULT_GUARD_MAPPINGS.map(mapping => mapping.from))
    const extras = configured.filter(mapping => !defaultFroms.has(mapping.from))
    return [...defaults, ...extras].slice(0, GUARD_MAX_MAPPINGS)
}

/**
 * 远程规则地址规范化：只接受 https。
 * 明文 http 会让规则在传输途中被改写，等于把拦截策略交给中间人。
 */
export function normalizeRemoteUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    try {
        const url = new URL(trimmed)
        return url.protocol === 'https:' ? url.href : undefined
    } catch {
        return undefined
    }
}

/**
 * 远程载荷：本机配置中**规则相关**的子集。
 * 偏好字段（maskOnSubmit / maskOnPaste）与地址本身不在其中，远程无从下发。
 */
export type GuardRemotePayload = {
    readonly rules?: Readonly<Record<string, GuardRuleSetting>>
    readonly terms?: readonly string[]
    readonly termAction?: GuardRuleSetting['action']
    readonly mappings?: readonly GuardMapping[]
}

/**
 * 解析远程 JSON：版本必须与本机一致，否则整份拒绝（防止未来格式被误读成有效规则）；
 * 单条损坏只丢弃该条。越界字段（maskOnSubmit / remoteUrl 等）直接忽略。
 */
export function parseGuardRulePayload(raw: unknown): GuardRemotePayload | undefined {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const record = raw as Record<string, unknown>
    if (record.version !== GUARD_CONFIG_VERSION) return undefined
    const payload: {
        rules?: Record<string, GuardRuleSetting>
        terms?: string[]
        termAction?: GuardRuleSetting['action']
        mappings?: GuardMapping[]
    } = {}
    if (record.rules !== null && typeof record.rules === 'object' && !Array.isArray(record.rules)) {
        const rules: Record<string, GuardRuleSetting> = {}
        for (const [id, value] of Object.entries(record.rules as Record<string, unknown>)) {
            const setting = parseRuleSetting(id, value)
            if (setting !== undefined) rules[id] = setting
        }
        payload.rules = rules
    }
    if (Array.isArray(record.terms)) payload.terms = parseTerms(record.terms)
    const action = parseAction(record.termAction)
    if (action !== undefined) payload.termAction = action
    if (Array.isArray(record.mappings)) payload.mappings = parseMappingList(record.mappings)
    return payload
}

/**
 * 严格解析外部配置：版本不符或非对象视为整体损坏（返回 undefined），
 * 单条规则损坏则丢弃该条并回落默认值，不牵连整份配置。
 */
export function parseGuardConfig(raw: unknown): GuardConfig | undefined {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const record = raw as Record<string, unknown>
    if (record.version !== GUARD_CONFIG_VERSION) return undefined
    const defaults = defaultGuardConfig()
    const rules: Record<string, GuardRuleSetting> = { ...defaults.rules }
    if (record.rules !== null && typeof record.rules === 'object' && !Array.isArray(record.rules)) {
        for (const [id, value] of Object.entries(record.rules as Record<string, unknown>)) {
            const setting = parseRuleSetting(id, value)
            if (setting !== undefined) rules[id] = setting
        }
    }
    const remoteUrl = normalizeRemoteUrl(record.remoteUrl)
    return {
        version: GUARD_CONFIG_VERSION,
        rules,
        terms: parseTerms(record.terms),
        termAction: parseAction(record.termAction) ?? defaults.termAction,
        mappings: record.mappings === undefined
            ? [...defaults.mappings]
            : mergeDefaultMappings(parseMappingList(record.mappings)),
        maskOnSubmit: typeof record.maskOnSubmit === 'boolean' ? record.maskOnSubmit : defaults.maskOnSubmit,
        maskOnPaste: typeof record.maskOnPaste === 'boolean' ? record.maskOnPaste : defaults.maskOnPaste,
        ...(remoteUrl === undefined ? {} : { remoteUrl }),
    }
}

export function readGuardConfig(storage: Storage | undefined): GuardConfig {
    if (storage === undefined) return defaultGuardConfig()
    try {
        const raw: unknown = JSON.parse(storage.getItem(GUARD_STORAGE_KEY) ?? 'null')
        return parseGuardConfig(raw) ?? defaultGuardConfig()
    } catch {
        return defaultGuardConfig()
    }
}

export function writeGuardConfig(storage: Storage | undefined, config: GuardConfig): void {
    if (storage === undefined) return
    try {
        storage.setItem(GUARD_STORAGE_KEY, JSON.stringify(config))
    } catch {
        // 隐私模式或配额不足时退化为本次页面内状态。
    }
}

/** 未知规则 id 原样返回，避免把误传的 id 写进配置。 */
export function updateGuardRule(config: GuardConfig, ruleId: string, patch: Partial<GuardRuleSetting>): GuardConfig {
    const current = config.rules[ruleId]
    if (current === undefined) return config
    return { ...config, rules: { ...config.rules, [ruleId]: { ...current, ...patch } } }
}

export function addGuardTerm(config: GuardConfig, term: string): GuardConfig {
    const normalized = normalizeGuardTerm(term)
    if (normalized === undefined) return config
    if (config.terms.includes(normalized) || config.terms.length >= GUARD_MAX_TERMS) return config
    return { ...config, terms: [...config.terms, normalized] }
}

export function removeGuardTerm(config: GuardConfig, term: string): GuardConfig {
    if (!config.terms.includes(term)) return config
    return { ...config, terms: config.terms.filter(entry => entry !== term) }
}

/** 同一 `from` 只保留一条：已存在时原样返回，避免静默覆盖用户既有映射。 */
export function addGuardMapping(config: GuardConfig, mapping: GuardMapping): GuardConfig {
    const normalized = normalizeGuardMapping(mapping)
    if (normalized === undefined) return config
    if (config.mappings.some(item => item.from === normalized.from)) return config
    if (config.mappings.length >= GUARD_MAX_MAPPINGS) return config
    return { ...config, mappings: [...config.mappings, normalized] }
}

export function removeGuardMapping(config: GuardConfig, from: string): GuardConfig {
    if (!config.mappings.some(item => item.from === from)) return config
    return { ...config, mappings: config.mappings.filter(item => item.from !== from) }
}
