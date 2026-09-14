import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'michengai.inputGuard'

const zh = {
    'guard.blocked': '检测到 {rules}，已阻止发送。请移除后重试。',
    'guard.askEdit': '检测到 {rules}，已阻止发送。请修改后再发送。',
    'guard.masked': '已就地脱敏 {rules}，确认后再发送。',
    'guard.pasteBlocked': '粘贴内容包含 {rules}，已取消本次粘贴。',
    'guard.ruleSeparator': '、',
    'guard.rule.unknown': '敏感信息',
    'guard.rule.pem-private-key': '私钥',
    'guard.rule.cloud-access-key': '云访问密钥',
    'guard.rule.llm-api-key': '模型 API Key',
    'guard.rule.vcs-token': '代码托管令牌',
    'guard.rule.slack-token': 'Slack 令牌',
    'guard.rule.google-api-key': 'Google API Key',
    'guard.rule.jwt': 'JWT',
    'guard.rule.bearer-token': 'Bearer 令牌',
    'guard.rule.basic-auth-url': '带口令的连接串',
    'guard.rule.generic-secret-assignment': '疑似口令赋值',
    'guard.rule.cn-id-card': '身份证号',
    'guard.rule.bank-card': '银行卡号',
    'guard.rule.cn-mobile': '手机号',
    'guard.rule.cn-landline': '固定电话',
    'guard.rule.cn-service-number': '客服号码',
    'guard.rule.email': '邮箱',
    'guard.rule.private-ip': '内网地址',
    'guard.rule.custom-term': '自定义敏感词',
} as const

const en: Record<keyof typeof zh, string> = {
    'guard.blocked': 'Blocked sending: {rules} detected. Remove them and try again.',
    'guard.askEdit': 'Blocked sending: {rules} detected. Edit the draft and send again.',
    'guard.masked': 'Masked {rules} in place. Review it, then send again.',
    'guard.pasteBlocked': 'Paste cancelled: the clipboard contains {rules}.',
    'guard.ruleSeparator': ', ',
    'guard.rule.unknown': 'sensitive data',
    'guard.rule.pem-private-key': 'private key',
    'guard.rule.cloud-access-key': 'cloud access key',
    'guard.rule.llm-api-key': 'model API key',
    'guard.rule.vcs-token': 'code hosting token',
    'guard.rule.slack-token': 'Slack token',
    'guard.rule.google-api-key': 'Google API key',
    'guard.rule.jwt': 'JWT',
    'guard.rule.bearer-token': 'bearer token',
    'guard.rule.basic-auth-url': 'connection string with a password',
    'guard.rule.generic-secret-assignment': 'suspected password assignment',
    'guard.rule.cn-id-card': 'national id number',
    'guard.rule.bank-card': 'bank card number',
    'guard.rule.cn-mobile': 'mobile number',
    'guard.rule.cn-landline': 'landline number',
    'guard.rule.cn-service-number': 'service hotline',
    'guard.rule.email': 'email address',
    'guard.rule.private-ip': 'internal address',
    'guard.rule.custom-term': 'blocked term',
}

export type GuardLocaleKey = keyof typeof zh

/** 提示文案键：词条映射路径全程静默，因此这里只列安全处置用到的键。 */
export type GuardNoticeKey =
    | 'guard.blocked'
    | 'guard.askEdit'
    | 'guard.masked'
    | 'guard.pasteBlocked'

// 词库命名空间是封闭集合，必须显式注册；否则 NS 不满足约束、t 会被推成 {}。
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'michengai.inputGuard': GuardLocaleKey
    }
}

/** 规则 id 到文案键的显式映射：不做动态拼键，缺规则时用兜底文案。 */
const RULE_LABEL_KEYS: Record<string, GuardLocaleKey> = {
    'pem-private-key': 'guard.rule.pem-private-key',
    'cloud-access-key': 'guard.rule.cloud-access-key',
    'llm-api-key': 'guard.rule.llm-api-key',
    'vcs-token': 'guard.rule.vcs-token',
    'slack-token': 'guard.rule.slack-token',
    'google-api-key': 'guard.rule.google-api-key',
    jwt: 'guard.rule.jwt',
    'bearer-token': 'guard.rule.bearer-token',
    'basic-auth-url': 'guard.rule.basic-auth-url',
    'generic-secret-assignment': 'guard.rule.generic-secret-assignment',
    'cn-id-card': 'guard.rule.cn-id-card',
    'bank-card': 'guard.rule.bank-card',
    'cn-mobile': 'guard.rule.cn-mobile',
    'cn-landline': 'guard.rule.cn-landline',
    'cn-service-number': 'guard.rule.cn-service-number',
    email: 'guard.rule.email',
    'private-ip': 'guard.rule.private-ip',
    'custom-term': 'guard.rule.custom-term',
}

export function guardRuleLabel(ruleId: string, t: TranslateNS<typeof NS>): string {
    const key = RULE_LABEL_KEYS[ruleId]
    return key === undefined ? t('guard.rule.unknown') : t(key)
}

/** 把命中规则聚合成一句可读提示；同类只报一次，顺序按规则表固定。 */
export function describeGuardRules(ruleIds: readonly string[], t: TranslateNS<typeof NS>): string {
    return [...new Set(ruleIds)].map(ruleId => guardRuleLabel(ruleId, t)).join(t('guard.ruleSeparator'))
}

export { en, zh }
