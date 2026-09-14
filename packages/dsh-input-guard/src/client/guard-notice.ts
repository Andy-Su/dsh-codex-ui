/**
 * 自绘提示浮层。
 *
 * 宿主的 `input.notify` 只把提示推进 InputNotice 列表：既没有超时，也没有清除接口
 * （已在 `@deepseek-ai/dsh-client-ui-conversation@0.1.5-rc.1` 的实现里确认——notice 只在 notify 时写入，
 * 包内不存在与该列表相关的定时器），因此提示会一直挂在输入框上。
 *
 * 这里改为插件自己渲染一个浮层，由插件控制「显示 3 秒后隐藏」。
 * 刻意不使用 react-dom 的 portal：直接操作 DOM 可以避免给宿主模块表新增依赖，
 * 也让显示、续期、清理三个时机完全可控。
 */

/** 提示可见时长：显示后 3 秒自动隐藏。 */
export const GUARD_NOTICE_VISIBLE_MS = 3000

export type GuardNoticeLevel = 'info' | 'error'

/** 沿用宿主与 Codex UI 都在使用的设计变量，全部带回退值，缺变量时也不会掉样式。 */
const BASE_STYLE: Partial<CSSStyleDeclaration> = {
    position: 'fixed',
    zIndex: '2147483000',
    maxWidth: 'min(420px, 80vw)',
    padding: '6px 10px',
    borderRadius: '8px',
    fontFamily: 'var(--dsw-font-family, system-ui)',
    fontSize: '12px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-primary, #ffffff)',
    background: 'var(--dsw-alias-bg-layer-2, rgba(28, 28, 30, 0.96))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14))',
    boxShadow: 'var(--dsw-shadow-lv4, 0 8px 24px rgba(0, 0, 0, 0.24))',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
}

const LEVEL_STYLE: Record<GuardNoticeLevel, Partial<CSSStyleDeclaration>> = {
    info: {},
    error: { color: 'var(--dsw-alias-state-error-primary, #ff7b72)' },
}

export class GuardNoticeLayer {
    private element: HTMLDivElement | undefined
    private timer: ReturnType<typeof setTimeout> | undefined

    constructor(private readonly owner: Document) { }

    /** 显示提示并重新开始计时；重复调用复用同一个元素，不会堆积。 */
    show(level: GuardNoticeLevel, text: string, anchor?: HTMLElement): void {
        const element = this.ensureElement()
        element.dataset.dcuGuardNotice = level
        element.setAttribute('role', level === 'error' ? 'alert' : 'status')
        element.textContent = text
        Object.assign(element.style, BASE_STYLE, LEVEL_STYLE[level])
        this.place(element, anchor)
        this.restart()
    }

    /** 已可见时只续期：用于「发送成功后再保留 3 秒」。未显示时不产生任何效果。 */
    hold(anchor?: HTMLElement): void {
        if (this.element === undefined) return
        if (anchor !== undefined) this.place(this.element, anchor)
        this.restart()
    }

    get visible(): boolean {
        return this.element !== undefined
    }

    dispose(): void {
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = undefined
        this.element?.remove()
        this.element = undefined
    }

    private restart(): void {
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.dispose() }, GUARD_NOTICE_VISIBLE_MS)
    }

    private ensureElement(): HTMLDivElement {
        if (this.element !== undefined) return this.element
        const element = this.owner.createElement('div')
        this.owner.body.append(element)
        this.element = element
        return element
    }

    /** 贴在输入框上方居中；输入框贴近视口顶部时退到底部，避免被裁掉。 */
    private place(element: HTMLDivElement, anchor?: HTMLElement): void {
        const above = anchor !== undefined && typeof anchor.getBoundingClientRect === 'function' && anchor.getBoundingClientRect().top >= 56
        if (!above) {
            element.style.left = '50%'
            element.style.top = 'auto'
            element.style.bottom = '96px'
            element.style.transform = 'translateX(-50%)'
            return
        }
        const rect = (anchor as HTMLElement).getBoundingClientRect()
        element.style.left = `${Math.round(rect.left + rect.width / 2)}px`
        element.style.top = `${Math.round(rect.top - 8)}px`
        element.style.bottom = 'auto'
        element.style.transform = 'translate(-50%, -100%)'
    }
}
