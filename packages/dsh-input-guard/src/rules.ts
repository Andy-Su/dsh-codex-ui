/**
 * 内置识别规则表。
 *
 * 模式约定参照 gitleaks（MIT）与 detect-secrets（Apache-2.0）的公开规则：
 * 高置信度凭证按「前缀 + 长度 + 结构」识别，个人信息额外过校验位，压低误报。
 * 本文件不引入任何运行时依赖，避免增加客户端 bundle 体积。
 */
import { cnIdCardValid, cnLandlineAreaCode, isCnLandline, isCnServiceNumber, isPrivateIpv4, luhnValid } from './validators.ts'

export type RuleAction = 'block' | 'mask'

export type GuardRule = {
    readonly id: string
    /** 默认动作；用户可在配置中逐条覆盖。 */
    readonly action: RuleAction
    readonly pattern: RegExp
    /** 命中后的脱敏替换文本；缺省时整体替换为 ***。 */
    readonly mask?: (value: string) => string
    /** 结构之外的置信度校验，返回 false 视为未命中。 */
    readonly accept?: (value: string) => boolean
}

/** 凭证类不保留任何原文字符。 */
const redactFully = (): string => '***'

export const GUARD_RULES: readonly GuardRule[] = [
    {
        id: 'pem-private-key',
        action: 'block',
        pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
        mask: redactFully,
    },
    {
        id: 'cloud-access-key',
        action: 'block',
        pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
        mask: redactFully,
    },
    {
        id: 'llm-api-key',
        action: 'block',
        pattern: /\b(?:sk-ant-|sk-|gsk_)[A-Za-z0-9_-]{16,}\b/g,
        mask: redactFully,
    },
    {
        id: 'vcs-token',
        action: 'block',
        pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g,
        mask: redactFully,
    },
    {
        id: 'slack-token',
        action: 'block',
        pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
        mask: redactFully,
    },
    {
        id: 'google-api-key',
        action: 'block',
        pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
        mask: redactFully,
    },
    {
        id: 'jwt',
        action: 'block',
        pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
        mask: redactFully,
    },
    {
        id: 'bearer-token',
        action: 'block',
        pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
        mask: redactFully,
    },
    {
        id: 'basic-auth-url',
        action: 'block',
        // 只隐藏口令，保留用户名与主机，便于用户确认自己粘的是哪条连接串。
        pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi,
        mask: value => value.replace(/(\/\/[^/:@]+:)[^@]+@/, '$1***@'),
    },
    {
        id: 'generic-secret-assignment',
        action: 'mask',
        pattern: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi,
        mask: value => value.replace(
            /([:=]\s*)(["']?)[^\s"',;]{8,}(["']?)$/,
            (_all, prefix: string, open: string, close: string) => `${prefix}${open}***${close}`,
        ),
    },
    {
        id: 'cn-id-card',
        action: 'mask',
        pattern: /\b\d{17}[\dXx]\b/g,
        accept: value => cnIdCardValid(value),
        // 沿用中文界面惯例：保留地区码与末段，其余抹平。
        mask: value => `${value.slice(0, 6)}${'*'.repeat(8)}${value.slice(-4)}`,
    },
    {
        id: 'bank-card',
        action: 'mask',
        pattern: /\b\d(?:[ -]?\d){15,18}\b/g,
        accept: value => luhnValid(value.replace(/\D/g, '')),
        mask: value => `****${value.replace(/\D/g, '').slice(-4)}`,
    },
    {
        id: 'cn-mobile',
        action: 'mask',
        // 容忍 +86 / 0086 前缀与空格、短横分组；前后边界避免吃掉更长的数字串。
        pattern: /(?<!\d)(?:\+?86|0086)?[- ]?(1[3-9]\d)[- ]?(\d{4})[- ]?(\d{4})(?!\d)/g,
        // 掩码统一为前三后四，不保留分隔符形态，与其他规则输出一致。
        mask: value => value.replace(/(1[3-9]\d)[- ]?\d{4}[- ]?(\d{4})/, '$1****$2'),
    },
    {
        id: 'cn-landline',
        action: 'mask',
        // 要求至少一处分隔符：纯连续数字更可能是账号或订单号，交回给用户自查。
        pattern: /(?<!\d)0\d{2,3}[- ]\d{3,4}[- ]?\d{4}(?!\d)|(?<!\d)0\d{2,3}\d{3,4}[- ]\d{4}(?!\d)/g,
        accept: value => isCnLandline(value),
        mask: value => {
            const area = cnLandlineAreaCode(value)
            return area === undefined ? '***' : `${area}****${value.replace(/\D/g, '').slice(-4)}`
        },
    },
    {
        id: 'cn-service-number',
        action: 'mask',
        // 400/800 按结构，五位短号按白名单（见 isCnServiceNumber）。
        pattern: /(?<!\d)(?:[48]00[- ]?\d{3}[- ]?\d{4}|(?:95|96)\d{3}|100\d{2})(?!\d)/g,
        accept: value => isCnServiceNumber(value),
        mask: value => {
            const digits = value.replace(/\D/g, '')
            return digits.length <= 6 ? `${digits.slice(0, 1)}****` : `${digits.slice(0, 3)}****${digits.slice(-4)}`
        },
    },
    {
        id: 'email',
        action: 'mask',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
        mask: value => `${value.slice(0, 1)}***@${value.slice(value.indexOf('@') + 1)}`,
    },
    {
        id: 'private-ip',
        action: 'mask',
        pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
        accept: value => isPrivateIpv4(value),
        mask: value => {
            const parts = value.split('.')
            return `${parts[0]}.${parts[1]}.***.***`
        },
    },
]

const RULES_BY_ID = new Map(GUARD_RULES.map(rule => [rule.id, rule]))

/** 配置里出现未知 id 时用于判定丢弃，而不是静默接受。 */
export function hasGuardRule(id: string): boolean {
    return RULES_BY_ID.has(id)
}

export function guardRule(id: string): GuardRule | undefined {
    return RULES_BY_ID.get(id)
}

/** 名单固定顺序即提示与文档里的展示顺序。 */
export const GUARD_RULE_IDS: readonly string[] = GUARD_RULES.map(rule => rule.id)
