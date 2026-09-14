import { describe, expect, it } from 'vitest'
import {
    decide,
    defaultGuardConfig,
    findingRuleIds,
    guard,
    scan,
    substitute,
    type GuardConfig,
    type GuardMapping,
} from '../src/detect.ts'

const config = (patch: Partial<GuardConfig> = {}): GuardConfig => ({ ...defaultGuardConfig(), ...patch })
const mapping = (from: string, to: string, enabled = true): GuardMapping => ({ from, to, enabled })
const ids = (draft: string, cfg: GuardConfig = config()): string[] => findingRuleIds(scan(draft, cfg))

describe('凭证类规则', () => {
    it.each([
        ['pem-private-key', '-----BEGIN RSA PRIVATE KEY-----'],
        ['cloud-access-key', 'AKIAIOSFODNN7EXAMPLE'],
        ['llm-api-key', 'sk-ant-api03-abcdefghijklmnopqrstuvwx'],
        ['vcs-token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
        ['slack-token', 'xoxb-123456789012-abcdefghijklmnop'],
        ['google-api-key', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
        ['jwt', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
        ['bearer-token', 'Bearer abcdefghijklmnopqrstuvwx'],
        ['basic-auth-url', 'postgres://admin:s3cr3t@db.internal:5432/app'],
    ])('%s 命中即阻断', (ruleId, draft) => {
        const verdict = decide(draft, config())
        expect(verdict.kind).toBe('block')
        expect(ids(draft)).toContain(ruleId)
    })

    it('凭证类脱敏不保留任何原文字符', () => {
        const rule = scan('AKIAIOSFODNN7EXAMPLE', config())[0]
        expect(rule.action).toBe('block')
        const masked = decide('key=AKIAIOSFODNN7EXAMPLE', config({ rules: { ...defaultGuardConfig().rules, 'cloud-access-key': { enabled: true, action: 'mask' as const } } }))
        expect(masked.kind).toBe('mask')
        expect(masked.kind === 'mask' ? masked.masked : '').toBe('key=***')
    })

    it('带口令连接串默认阻断；切换为脱敏时只隐藏口令，保留用户名与主机', () => {
        const draft = 'postgres://admin:s3cr3t@db.internal:5432/app'
        expect(decide(draft, config()).kind).toBe('block')
        const verdict = decide(draft, config({
            rules: { ...defaultGuardConfig().rules, 'basic-auth-url': { enabled: true, action: 'mask' as const } },
        }))
        expect(verdict.kind === 'mask' ? verdict.masked : '').toBe('postgres://admin:***@db.internal:5432/app')
    })

    it('词边界阻止把普通单词误判为密钥前缀', () => {
        for (const draft of ['task-abcdefghijklmnop', '磁盘路径 sk- 说明', 'prefixxoxb-123456789012']) {
            expect(ids(draft)).toEqual([])
        }
    })
})

describe('个人信息类规则', () => {
    it('身份证号按校验位识别并保留地区码与末段', () => {
        const verdict = decide('身份证 11010519491231002X 请核对', config())
        expect(verdict.kind === 'mask' ? verdict.masked : '').toBe('身份证 110105********002X 请核对')
    })

    it('18 位订单号不判为身份证', () => {
        expect(ids('订单号 110105194912310021')).toEqual([])
    })

    it('银行卡号过 Luhn 校验并保留末四位', () => {
        const verdict = decide('卡号 4111111111111111', config())
        expect(verdict.kind === 'mask' ? verdict.masked : '').toBe('卡号 ****1111')
    })

    it('占位符式卡号（Luhn 不过）放行', () => {
        expect(ids('卡号 4111111111111112')).toEqual([])
    })

    it('手机号保留前三后四', () => {
        const verdict = decide('电话 +86 13800138000', config())
        expect(verdict.kind === 'mask' ? verdict.masked : '').toBe('电话 +86 138****8000')
    })

    it('手机号容忍空格与短横分组，掩码统一为前三后四', () => {
        for (const [draft, expected] of [
            ['138 0013 8000', '138****8000'],
            ['138-0013-8000', '138****8000'],
            ['008613800138000', '0086138****8000'],
            ['+86 138 0013 8000', '+86 138****8000'],
        ]) {
            const verdict = decide(draft, config())
            expect(verdict.kind === 'mask' ? verdict.masked : `${verdict.kind}`).toBe(expected)
        }
    })

    it('位数不足的号码片段不误伤', () => {
        for (const draft of ['138 0013 800', '1380013800', '138 0013']) expect(ids(draft)).toEqual([])
    })

    it('固定电话要求分隔符并校验区号与位数', () => {
        for (const [draft, expected] of [
            ['010-12345678', '010****5678'],
            ['021 1234 5678', '021****5678'],
            ['0571-88888888', '0571****8888'],
            ['0371 1234567', '0371****4567'],
        ]) {
            const verdict = decide(draft, config())
            expect(verdict.kind === 'mask' ? verdict.masked : `${verdict.kind}`).toBe(expected)
        }
    })

    it('无分隔符的 11 位纯数字、非法区号都不判为固话', () => {
        for (const draft of ['01012345678', '9999-12345678', '010-1234']) expect(ids(draft)).toEqual([])
    })

    it('服务号按结构加白名单识别，普通五位数字不误伤', () => {
        for (const [draft, expected] of [
            ['400-800-8888', '400****8888'],
            ['4008008888', '400****8888'],
            ['95588', '9****'],
            ['10086', '1****'],
        ]) {
            const verdict = decide(draft, config())
            expect(verdict.kind === 'mask' ? verdict.masked : `${verdict.kind}`).toBe(expected)
        }
        for (const draft of ['95200', '400 123456', '1234001234567']) expect(ids(draft)).toEqual([])
    })

    it('邮箱只脱敏本地部分', () => {
        const verdict = decide('联系 alice@example.com', config())
        expect(verdict.kind === 'mask' ? verdict.masked : '').toBe('联系 a***@example.com')
    })

    it('内网地址打码，公网地址放行', () => {
        const verdict = decide('服务在 192.168.1.10 上', config())
        expect(verdict.kind === 'mask' ? verdict.masked : '').toBe('服务在 192.168.***.*** 上')
        for (const draft of ['8.8.8.8', '172.32.0.1', '11.0.0.1']) expect(ids(draft)).toEqual([])
    })

    it('赋值类脱敏只替换值本身', () => {
        const verdict = decide('配置 password=hunter2xyz 请勿外传', config())
        expect(verdict.kind).toBe('mask')
        expect(verdict.kind === 'mask' ? verdict.masked : '').toBe('配置 password=*** 请勿外传')
    })

    it('普通中文里的「密码」二字不误伤', () => {
        expect(ids('请把密码告诉我')).toEqual([])
    })
})

describe('命中判定', () => {
    it('同时命中阻断与打码时 block 优先', () => {
        const verdict = decide('key AKIAIOSFODNN7EXAMPLE 邮箱 alice@example.com', config())
        expect(verdict.kind).toBe('block')
        expect([...ids('key AKIAIOSFODNN7EXAMPLE 邮箱 alice@example.com')].sort()).toEqual(['cloud-access-key', 'email'])
    })

    it('重叠命中只打码最外层一处', () => {
        const masked = config({ rules: { ...defaultGuardConfig().rules, 'basic-auth-url': { enabled: true, action: 'mask' as const } } })
        expect(decide('postgres://admin:s3cr3t@db.internal:5432/app', masked)).toMatchObject({
            kind: 'mask',
            masked: 'postgres://admin:***@db.internal:5432/app',
        })
    })

    it('同一处文本同时命中阻断与打码时阻断胜出', () => {
        expect(decide('postgres://admin:s3cr3t@db.internal:5432/app', config()).kind).toBe('block')
    })

    it('关闭单条规则后不再命中', () => {
        const rules = { ...defaultGuardConfig().rules, email: { enabled: false, action: 'mask' as const } }
        expect(ids('联系 alice@example.com', config({ rules }))).toEqual([])
    })

    it('空草稿直接放行', () => {
        expect(decide('', config())).toEqual({ kind: 'allow' })
    })

    it('自定义敏感词的默认动作可切换为阻断', () => {
        expect(decide('客户编号 A123', config({ terms: ['客户编号'] })).kind).toBe('mask')
        expect(decide('客户编号 A123', config({ terms: ['客户编号'], termAction: 'block' })).kind).toBe('block')
        expect(ids('客户编号 A123', config({ terms: ['客户编号'] }))).toEqual(['custom-term'])
    })

    it('ASCII 词条按词边界匹配且忽略大小写', () => {
        const cfg = config({ terms: ['foo'] })
        expect(ids('foo bar', cfg)).toEqual(['custom-term'])
        expect(ids('FOO', cfg)).toEqual(['custom-term'])
        expect(ids('foobar', cfg)).toEqual([])
    })
})

describe('词条映射替换', () => {
    it('CJK 词条按子串替换并保持前后文', () => {
        const result = substitute('前缀喵喵后缀', config({ mappings: [mapping('喵喵', '茄子')] }))
        expect(result.text).toBe('前缀茄子后缀')
        expect(result.substitutions).toEqual([{ from: '喵喵', to: '茄子', start: 2, end: 4 }])
    })

    it('替换文本长度变化时偏移仍取自原串', () => {
        const result = substitute('A喵喵B喵喵C', config({ mappings: [mapping('喵喵', '很长的新词')] }))
        expect(result.text).toBe('A很长的新词B很长的新词C')
        expect(result.substitutions.map(item => item.start)).toEqual([1, 4])
    })

    it('起点相同取更长者，且不递归替换', () => {
        expect(substitute('喵喵', config({ mappings: [mapping('喵', 'A'), mapping('喵喵', 'B')] })).text).toBe('B')
        expect(substitute('ab', config({ mappings: [mapping('ab', 'cd'), mapping('cd', 'ef')] })).text).toBe('cd')
    })

    it('ASCII 映射走词边界，CJK 映射不做边界判断', () => {
        const cfg = config({ mappings: [mapping('ab', 'x')] })
        expect(substitute('ab cd', cfg).text).toBe('x cd')
        expect(substitute('abab', cfg).text).toBe('abab')
        expect(substitute('喵喵喵', config({ mappings: [mapping('喵喵', '茄')] })).text).toBe('茄喵')
    })

    it('停用的映射不参与替换', () => {
        expect(substitute('喵喵', config({ mappings: [mapping('喵喵', '茄子', false)] })).text).toBe('喵喵')
    })

    it('无映射或无命中时原样返回且不产生替换记录', () => {
        expect(substitute('喵喵', config())).toEqual({ text: '喵喵', substitutions: [] })
        expect(substitute('别的词', config({ mappings: [mapping('喵喵', '茄子')] })).substitutions).toEqual([])
    })
})

describe('合法预算（先替换、后打码）', () => {
    it('纯映射命中判定为静默改写', () => {
        const outcome = guard('喵喵', config({ mappings: [mapping('喵喵', '茄子')] }))
        expect(outcome).toMatchObject({ kind: 'rewrite', text: '茄子', reason: 'mapping', findings: [] })
    })

    it('映射与打码同时命中时标记为 both', () => {
        const outcome = guard('邮箱 alice@example.com', config({ mappings: [mapping('邮箱', '邮件地址')] }))
        expect(outcome).toMatchObject({ kind: 'rewrite', text: '邮件地址 a***@example.com', reason: 'both' })
        expect(outcome.kind === 'rewrite' ? findingRuleIds(outcome.findings) : []).toEqual(['email'])
    })

    it('阻断优先于映射：命中凭证时不做任何替换', () => {
        const outcome = guard('喵喵 AKIAIOSFODNN7EXAMPLE', config({ mappings: [mapping('喵喵', '茄子')] }))
        expect(outcome.kind).toBe('block')
    })

    it('映射出的文本仍受安全规则约束', () => {
        const outcome = guard('喵喵', config({ mappings: [mapping('喵喵', 'AKIAIOSFODNN7EXAMPLE')] }))
        expect(outcome).toMatchObject({ kind: 'block' })
    })

    it('映射结果为已知敏感词时按打码处理', () => {
        const outcome = guard('喵喵', config({ terms: ['茄子'], mappings: [mapping('喵喵', '茄子')] }))
        expect(outcome).toMatchObject({ kind: 'rewrite', text: '***', reason: 'both' })
    })

    it('无命中时放行', () => {
        expect(guard('普通提问', config({ mappings: [mapping('喵喵', '茄子')] }))).toEqual({ kind: 'allow' })
        expect(guard('', config())).toEqual({ kind: 'allow' })
    })
})
