/**
 * 敏感信息扫描、词条映射替换与处置判定（纯函数）。
 *
 * 输入是草稿文本与配置，输出命中列表、改写后的文本或最终判定；
 * 不触碰 DOM、不发请求，因此可以在 jsdom、Node 乃至未来的 Host 侧复用同一份判定。
 *
 * 两类语义严格区分（见方案 §12.1）：
 * - 安全处置（block / mask）：插件内置规则，命中必须打断发送并给出原因；
 * - 词条映射（replace）：用户主动配置，命中只改写草稿，静默、不告警。
 */
import { DEFAULT_GUARD_MAPPINGS } from './default-mappings.ts'
import { GUARD_RULES, guardRule, type RuleAction } from './rules.ts'
import { GUARD_TERM_RULE_ID, matchGuardTerm } from './terms.ts'

export type { RuleAction } from './rules.ts'

export type GuardRuleSetting = {
    readonly enabled: boolean
    readonly action: RuleAction
}

/** 一条词条映射：`from` 在草稿中出现时替换为 `to`。 */
export type GuardMapping = {
    readonly from: string
    readonly to: string
    readonly enabled: boolean
}

export type GuardConfig = {
    readonly version: 1
    readonly rules: Readonly<Record<string, GuardRuleSetting>>
    readonly terms: readonly string[]
    readonly termAction: RuleAction
    /** 词条映射表；与安全规则互不影响。 */
    readonly mappings: readonly GuardMapping[]
    /** Enter 命中可脱敏项时是否就地改写草稿；false 只提示、由用户自行修改。 */
    readonly maskOnSubmit: boolean
    /** 粘贴命中可脱敏项时是否就地打码；默认 true。 */
    readonly maskOnPaste: boolean
    /**
     * 远程规则地址（仅本地可设）。远程载荷无权改写它，
     * 也不得覆盖 maskOnSubmit / maskOnPaste，避免规则来源反过来改变本机行为。
     */
    readonly remoteUrl?: string
}

export type Finding = {
    readonly ruleId: string
    readonly start: number
    readonly end: number
    readonly action: RuleAction
}

export type Verdict =
    | { readonly kind: 'allow' }
    | { readonly kind: 'mask'; readonly masked: string; readonly findings: readonly Finding[] }
    | { readonly kind: 'block'; readonly findings: readonly Finding[] }

export type Substitution = {
    readonly from: string
    readonly to: string
    readonly start: number
    readonly end: number
}

export type SubstitutionResult = {
    readonly text: string
    readonly substitutions: readonly Substitution[]
}

/** 拦截层唯一入口的返回值：放行、阻断，或改写草稿。 */
export type GuardOutcome =
    | { readonly kind: 'allow' }
    | { readonly kind: 'block'; readonly findings: readonly Finding[] }
    | {
        readonly kind: 'rewrite'
        readonly text: string
        /** 触发改写的安全命中；空数组表示这次改写纯粹来自词条映射。 */
        readonly findings: readonly Finding[]
        readonly substitutions: readonly Substitution[]
        readonly reason: 'mask' | 'mapping' | 'both'
    }

/** 规则未声明 mask 时的兜底替换文本。 */
export const GUARD_REDACTED = '***'

export function defaultGuardConfig(): GuardConfig {
    const rules: Record<string, GuardRuleSetting> = {}
    for (const rule of GUARD_RULES) rules[rule.id] = { enabled: true, action: rule.action }
    return {
        version: 1,
        rules,
        terms: [],
        termAction: 'mask',
        mappings: [...DEFAULT_GUARD_MAPPINGS],
        maskOnSubmit: true,
        maskOnPaste: true,
    }
}

/** block 优先，其次按起始位置，再取更长命中，最后按 id 保证顺序稳定。 */
function compareFindings(left: Finding, right: Finding): number {
    if (left.start !== right.start) return left.start - right.start
    if (left.action !== right.action) return left.action === 'block' ? -1 : 1
    if (left.end !== right.end) return right.end - left.end
    return left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0
}

/** 只按位置与长度比较，用于打码时的重叠消解。 */
function compareSpans(left: Finding, right: Finding): number {
    if (left.start !== right.start) return left.start - right.start
    return right.end - left.end
}

export function scan(draft: string, config: GuardConfig): Finding[] {
    if (draft === '') return []
    const findings: Finding[] = []
    for (const rule of GUARD_RULES) {
        const setting = config.rules[rule.id]
        if (setting === undefined || !setting.enabled) continue
        for (const match of draft.matchAll(rule.pattern)) {
            const value = match[0]
            if (value === '') continue
            if (rule.accept !== undefined && !rule.accept(value)) continue
            const start = match.index ?? 0
            findings.push({ ruleId: rule.id, start, end: start + value.length, action: setting.action })
        }
    }
    for (const term of config.terms) {
        for (const span of matchGuardTerm(draft, term)) {
            findings.push({ ruleId: GUARD_TERM_RULE_ID, start: span.start, end: span.end, action: config.termAction })
        }
    }
    return findings.sort(compareFindings)
}

function maskValue(value: string, ruleId: string): string {
    const rule = ruleId === GUARD_TERM_RULE_ID ? undefined : guardRule(ruleId)
    return rule?.mask === undefined ? GUARD_REDACTED : rule.mask(value)
}

/** 按跨度左到右替换；重叠命中只保留先出现且更长的那个，避免重复打码。 */
function maskDraft(draft: string, findings: readonly Finding[]): string {
    const ordered = findings.filter(finding => finding.action === 'mask').sort(compareSpans)
    let cursor = 0
    let output = ''
    for (const finding of ordered) {
        if (finding.start < cursor) continue
        output += draft.slice(cursor, finding.start) + maskValue(draft.slice(finding.start, finding.end), finding.ruleId)
        cursor = finding.end
    }
    return output + draft.slice(cursor)
}

/** 一次调用给出可直接用于交互的判定：放行、打码稿或阻断。 */
export function decide(draft: string, config: GuardConfig): Verdict {
    const findings = scan(draft, config)
    if (findings.length === 0) return { kind: 'allow' }
    if (findings.some(finding => finding.action === 'block')) return { kind: 'block', findings }
    return { kind: 'mask', masked: maskDraft(draft, findings), findings }
}

/** 命中规则名去重后按固定顺序返回，供提示文案复用。 */
export function findingRuleIds(findings: readonly Finding[]): string[] {
    return [...new Set(findings.map(finding => finding.ruleId))]
}

/**
 * 词条映射替换：单次扫描、最长优先、不递归。
 *
 * 从原草稿取偏移切片拼接，因此替换文本长度变化不需要维护偏移增量；
 * 替换结果不再参与本轮匹配，避免 `喵喵→茄子` 与 `茄子→喵喵` 互转死循环。
 */
export function substitute(draft: string, config: GuardConfig): SubstitutionResult {
    if (draft === '' || config.mappings.length === 0) return { text: draft, substitutions: [] }
    const candidates: Substitution[] = []
    for (const mapping of config.mappings) {
        if (!mapping.enabled) continue
        for (const span of matchGuardTerm(draft, mapping.from)) {
            candidates.push({ from: mapping.from, to: mapping.to, start: span.start, end: span.end })
        }
    }
    candidates.sort((left, right) => (left.start - right.start) || (right.end - left.end))
    const kept: Substitution[] = []
    let cursor = 0
    for (const candidate of candidates) {
        if (candidate.start < cursor) continue
        kept.push(candidate)
        cursor = candidate.end
    }
    if (kept.length === 0) return { text: draft, substitutions: [] }
    let output = ''
    let index = 0
    for (const substitution of kept) {
        output += draft.slice(index, substitution.start) + substitution.to
        index = substitution.end
    }
    return { text: output + draft.slice(index), substitutions: kept }
}

/**
 * 拦截层唯一入口：先判安全阻断，再做词条替换，最后在替换结果上再跑一次安全判定。
 *
 * 第三遍是刻意的：替换出来的文本同样要过安全规则，避免映射成为绕过过滤的通道
 * （例如把 `喵喵` 映射成一个真实密钥）。
 */
export function guard(draft: string, config: GuardConfig): GuardOutcome {
    if (draft === '') return { kind: 'allow' }
    const direct = decide(draft, config)
    if (direct.kind === 'block') return { kind: 'block', findings: direct.findings }
    const { text, substitutions } = substitute(draft, config)
    const afterSubstitute = text === draft ? direct : decide(text, config)
    if (afterSubstitute.kind === 'block') return { kind: 'block', findings: afterSubstitute.findings }
    const masked = afterSubstitute.kind === 'mask' ? afterSubstitute.masked : text
    if (masked === draft) return { kind: 'allow' }
    const findings = afterSubstitute.kind === 'mask' ? afterSubstitute.findings : []
    return {
        kind: 'rewrite',
        text: masked,
        findings,
        substitutions,
        reason: substitutions.length > 0 ? (findings.length > 0 ? 'both' : 'mapping') : 'mask',
    }
}
