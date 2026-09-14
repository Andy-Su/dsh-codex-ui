/**
 * 输入框上的拦截层：Enter 提交与粘贴两条路径。
 *
 * 监听挂在 ownerDocument 的**捕获阶段**：同一节点上的监听器按注册顺序执行
 * （capture 标志不改变 target 阶段的顺序），而宿主编辑器先于本插件注册、
 * 提交时往往会 preventDefault；只有更早的捕获才能真正拦下本次发送。
 * 作用范围仍由 `editor.contains(target)` 限定，不影响侧栏、搜索等其他输入面。
 *
 * 其余守卫沿用 Codex UI 已验证的约定：IME、修饰键、更早的处理器已处理、
 * 相位繁忙等情形一律完全放行，只接管「干净的一次交互」。
 */
import { guard, type GuardConfig, type GuardOutcome } from '../detect.ts'

export type GuardTrigger = 'submit' | 'paste'

export interface GuardInterception {
    /** 当前草稿的剪贴板投影文本。 */
    draft(): string
    /** 相位繁忙、含结构化引用或图片、触发菜单打开时必须为 true。 */
    busy(): boolean
    /** 诊断辅助：说明当前为何繁忙；仅在首次因繁忙放行时输出。 */
    describeBusy?(): string
    onOutcome(outcome: GuardOutcome, trigger: GuardTrigger): void
}

export function bindGuardKeys(editor: HTMLElement, interception: GuardInterception, config: GuardConfig): () => void {
    // 绑在 document 而非 editor：editor 上的监听器会晚于宿主先注册的提交处理器执行。
    const owner = editor.ownerDocument
    /** 只处理落在编辑器内的按键/粘贴，避免影响侧栏、搜索等其他输入面。 */
    const inside = (event: Event): boolean => event.target === editor
        || (event.target instanceof Node && editor.contains(event.target))
    let composing = false
    // 每种放行原因只提示一次：实机能据此定位，又不会在正常聊天时刷屏。
    const reported = new Set<string>()
    const skipOnce = (reason: string, detail?: string): void => {
        if (reported.has(reason)) return
        reported.add(reason)
        console.info(`[michengai-input-guard] Enter 未拦截：${reason}`, detail ?? '')
    }
    const begin = (event: CompositionEvent): void => { if (inside(event)) composing = true }
    // compositionend 无条件清除：组合可能在别的节点结束，漏掉一次标志就会永久放行。
    const end = (): void => { composing = false }
    const keydown = (event: KeyboardEvent): void => {
        if (!inside(event)) return
        if (event.key !== 'Enter') return
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
        try {
            if (event.defaultPrevented) return skipOnce('更早的处理器已处理（defaultPrevented）')
            if (composing) return skipOnce('输入法组合中（composing 标志）')
            if (event.isComposing || event.keyCode === 229) {
                return skipOnce('输入法组合中（isComposing / keyCode 229）', `isComposing=${event.isComposing} keyCode=${event.keyCode}`)
            }
            if (interception.busy()) return skipOnce('相位繁忙或触发菜单打开', interception.describeBusy?.() ?? '')
            const draft = interception.draft()
            const outcome = guard(draft, config)
            // 只报长度，不输出草稿内容，避免把敏感信息写进控制台。
            if (outcome.kind === 'allow') return skipOnce('未命中任何规则', `草稿长度=${draft.length}`)
            // 映射改写同样先拦下本次发送：草稿改写与宿主提交之间存在时序缝隙，
            // 放行会有把原文发出去的风险，因此统一要求用户确认后再发。
            event.preventDefault()
            event.stopImmediatePropagation()
            interception.onOutcome(outcome, 'submit')
        } catch (error) {
            // 任何内部异常都不得逃逸到宿主的按键流：放行本次，并留下可诊断痕迹。
            console.error('[michengai-input-guard] 拦截过程中出错，本次放行：', error)
        }
    }
    const paste = (event: Event): void => {
        if (!inside(event)) return
        if (event.defaultPrevented) return
        try {
            const text = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? ''
            if (text === '') return
            const outcome = guard(text, config)
            if (outcome.kind === 'allow') return
            if (outcome.kind === 'block') {
                event.preventDefault()
                event.stopImmediatePropagation()
                interception.onOutcome(outcome, 'paste')
                return
            }
            // 改写需要在文本真正落入编辑器后按整份草稿重算，因此这里放行、由调用方续接。
            // 粘贴路径整体由 maskOnPaste 控制；关闭时 Enter 的兜底路径仍会处理映射。
            if (config.maskOnPaste) interception.onOutcome(outcome, 'paste')
        } catch (error) {
            console.error('[michengai-input-guard] 粘贴处理出错，本次放行：', error)
        }
    }
    owner.addEventListener('compositionstart', begin, true)
    owner.addEventListener('compositionend', end, true)
    owner.addEventListener('keydown', keydown, true)
    owner.addEventListener('paste', paste, true)
    return () => {
        owner.removeEventListener('compositionstart', begin, true)
        owner.removeEventListener('compositionend', end, true)
        owner.removeEventListener('keydown', keydown, true)
        owner.removeEventListener('paste', paste, true)
    }
}
