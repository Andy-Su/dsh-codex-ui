import type { GuardConfig } from './detect.ts'

/**
 * 可热替换的配置源。
 *
 * 插槽注册发生在 apply 期间，此时远程规则尚未到达；因此先用本地与缓存配置立即注册，
 * 远程规则解析成功后再调用 replace。dock 通过 useSyncExternalStore 订阅本对象，
 * 于是远程内容无需重启即可生效。getSnapshot / subscribe 用箭头属性保证引用稳定，
 * 这是 useSyncExternalStore 的前提。
 */
export class GuardConfigStore {
    private current: GuardConfig

    private readonly listeners = new Set<() => void>()

    constructor(initial: GuardConfig) {
        this.current = initial
    }

    getSnapshot = (): GuardConfig => this.current

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    replace(next: GuardConfig): void {
        this.current = next
        for (const listener of [...this.listeners]) listener()
    }
}
