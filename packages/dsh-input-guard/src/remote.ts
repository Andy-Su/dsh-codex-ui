/**
 * 远程规则：从本机配置的 https 地址拉取**规则相关字段**，远程优先覆盖本地。
 *
 * 边界（均已与本仓库方案确认）：
 * - 偏好字段（maskOnSubmit / maskOnPaste）与规则地址本身始终以本地为准；
 * - 不允许远程关停全部阻断规则，否则拦截会静默失效；
 * - 拉取失败、超时、校验不通过一律回落本地与缓存，绝不因网络问题让拦截失效。
 *
 * 本模块保持纯逻辑（不触碰 DOM、不读全局），编排放在客户端半边的 apply 里。
 */
import { mergeDefaultMappings, normalizeRemoteUrl, parseGuardRulePayload, type GuardRemotePayload } from './config.ts'
import type { GuardConfig, GuardRuleSetting } from './detect.ts'
import { hasGuardRule } from './rules.ts'

export type { GuardRemotePayload } from './config.ts'

/** 单次拉取的寿命上限；注册流程不等待它，因此这里只约束请求本身。 */
export const REMOTE_FETCH_TIMEOUT_MS = 1500
/** 响应体上限：远程规则是一份声明式小文件，超大响应按异常处理。 */
export const REMOTE_MAX_BYTES = 65_536
/** 远程规则缓存键；与用户手改的本地配置分键存放，互不污染。 */
export const GUARD_REMOTE_CACHE_KEY = 'michengai.codex-ui.input-guard.remote-cache.v1'

/** 是否仍有至少一条启用的内置阻断规则。 */
function hasEnabledBlockRule(rules: Readonly<Record<string, GuardRuleSetting>>): boolean {
    return Object.entries(rules).some(([id, setting]) => (
        setting.enabled && setting.action === 'block' && hasGuardRule(id)
    ))
}

/**
 * 远程优先合并：`rules` 逐条覆盖，`terms` / `termAction` 整体替换，
 * `mappings` 合到内置默认映射之上（同名 `from` 以远程为准）。
 * 其余字段（含 remoteUrl、maskOnSubmit、maskOnPaste）原样保留本地值。
 * 被护栏拒绝的部分不会写入结果，原因通过 notes 返回给调用方输出到控制台。
 */
export function mergeRemoteConfig(
    local: GuardConfig,
    payload: GuardRemotePayload,
): { config: GuardConfig; notes: string[] } {
    const notes: string[] = []
    let rules = local.rules
    if (payload.rules !== undefined) {
        const merged = { ...local.rules, ...payload.rules }
        if (hasEnabledBlockRule(merged)) rules = merged
        else notes.push('远程规则会关停全部阻断规则，已拒绝该部分并保留本地规则。')
    }
    return {
        config: {
            ...local,
            rules,
            terms: payload.terms ?? local.terms,
            termAction: payload.termAction ?? local.termAction,
            mappings: payload.mappings === undefined ? local.mappings : mergeDefaultMappings(payload.mappings),
        },
        notes,
    }
}

/**
 * 拉取并解析远程规则；任何异常（协议不符、超时、非 2xx、非 JSON、体积超限）都返回
 * undefined，由调用方决定回落策略。
 */
export async function fetchRemotePayload(
    url: string,
    fetchImpl: typeof fetch = fetch,
): Promise<GuardRemotePayload | undefined> {
    if (normalizeRemoteUrl(url) === undefined) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS)
    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
            cache: 'no-store',
        })
        if (!response.ok) return undefined
        const declared = Number(response.headers.get('content-length') ?? '0')
        if (Number.isFinite(declared) && declared > REMOTE_MAX_BYTES) return undefined
        const text = await response.text()
        if (text.length > REMOTE_MAX_BYTES) return undefined
        return parseGuardRulePayload(JSON.parse(text))
    } catch {
        return undefined
    } finally {
        clearTimeout(timer)
    }
}

/** 读取上次成功拉取的远程规则；缺失、损坏或存储不可用都返回 undefined。 */
export function readRemoteCache(storage: Storage | undefined): GuardRemotePayload | undefined {
    if (storage === undefined) return undefined
    try {
        const raw: unknown = JSON.parse(storage.getItem(GUARD_REMOTE_CACHE_KEY) ?? 'null')
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
        const payload = (raw as { payload?: unknown }).payload
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
        // 缓存由本模块写入，版本号在存取间被剥离，因此这里补回后再走同一套校验。
        return parseGuardRulePayload({ ...(payload as Record<string, unknown>), version: 1 })
    } catch {
        return undefined
    }
}

/** 缓存远程规则原文（便于离线继续生效）；写入失败静默降级为仅本次页面生效。 */
export function writeRemoteCache(storage: Storage | undefined, payload: GuardRemotePayload): void {
    if (storage === undefined) return
    try {
        storage.setItem(
            GUARD_REMOTE_CACHE_KEY,
            JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), payload }),
        )
    } catch {
        // 隐私模式或配额不足时不缓存，功能不受影响。
    }
}
