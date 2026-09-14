import type { Context } from '@deepseek-ai/cordis'
import type { } from '@deepseek-ai/dsh-client-locale/client'
import { readGuardConfig } from '../config.ts'
import { GuardConfigStore } from '../config-store.ts'
import type { GuardConfig } from '../detect.ts'
import { en, NS, zh } from '../locales.ts'
import { fetchRemotePayload, mergeRemoteConfig, readRemoteCache, writeRemoteCache } from '../remote.ts'
import { registerInputGuard } from './guard-dock.tsx'

/** 需要的宿主服务：插槽、会话、输入机器、触发菜单与词典。 */
export const inject = ['slots', 'sessions', 'conversation', 'inputTriggers', 'locale']

/** 浏览器半边：只注册一个隐形输入扩展，不替换宿主任何 UI。 */
export function apply(ctx: Context): void {
    // 先报到再注册：加载失败与注册失败可以据此区分。
    console.info('[michengai-input-guard] 客户端半边已加载，开始注册输入拦截。')
    // 词典必须运行时注册：只有类型声明时，带 locale 的插槽拿不到文案，提示会退化成 key。
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'michengai-input-guard: dictionaries')

    let storage: Storage | undefined
    try {
        storage = window.localStorage
    } catch {
        console.warn('[michengai-input-guard] 浏览器存储不可用，本次会话使用默认规则。')
    }

    const local = readGuardConfig(storage)
    // 先用缓存里的远程规则合成首屏配置：离线或首次请求失败时，上次的远程效果仍然生效。
    const cached = readRemoteCache(storage)
    const initial = cached === undefined ? local : mergeRemoteConfig(local, cached).config
    const store = new GuardConfigStore(initial)
    registerInputGuard(ctx, store)
    if (local.remoteUrl === undefined) {
        console.info('[michengai-input-guard] 未配置远程规则地址，使用本地配置。')
    } else {
        // 远程刷新不阻塞注册：拦截从第一帧就可用，远程内容到达后再热替换。
        void refreshRemoteRules(storage, store, local)
    }
}

/**
 * 后台拉取远程规则并热替换。任何失败都沿用当前配置，只留一行控制台记录，
 * 绝不因为网络问题让拦截能力降级或消失。
 */
async function refreshRemoteRules(
    storage: Storage | undefined,
    store: GuardConfigStore,
    local: GuardConfig,
): Promise<void> {
    const url = local.remoteUrl
    if (url === undefined) return
    const payload = await fetchRemotePayload(url)
    if (payload === undefined) {
        console.info(`[michengai-input-guard] 远程规则不可用，继续使用本地与缓存配置：${url}`)
        return
    }
    const { config, notes } = mergeRemoteConfig(local, payload)
    for (const note of notes) console.warn(`[michengai-input-guard] ${note}`)
    // 只写独立缓存键，不写回本地配置：用户手改的内容不被远程内容污染。
    writeRemoteCache(storage, payload)
    store.replace(config)
    console.info(`[michengai-input-guard] 已应用远程规则（${url}）。`)
}
