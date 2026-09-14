import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 包内独立编译时，ctx 上的服务增强不会自动加载，必须显式引入所需半边。
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { guard, findingRuleIds, type Finding, type GuardOutcome } from '../detect.ts'
import type { GuardConfigStore } from '../config-store.ts'
import { describeGuardRules, NS, type GuardNoticeKey } from '../locales.ts'
import { bindGuardKeys, type GuardTrigger } from './guard-keys.ts'
import { GuardNoticeLayer, type GuardNoticeLevel } from './guard-notice.ts'

/**
 * 与 Codex UI 的 `findComposer` 同款策略：从本插槽向上寻找唯一输入框，避免误绑侧栏或搜索框。
 * 两个包需能独立安装，因此这里保留一份最小副本而不是跨包引用。
 */
function findComposer(anchor: HTMLElement): HTMLElement | undefined {
  let parent = anchor.parentElement
  while (parent !== null && parent !== document.body) {
    const editors = parent.querySelectorAll<HTMLElement>('textarea:not([disabled]), [data-lexical-editor="true"][contenteditable="true"]')
    if (editors.length === 1) return editors[0]
    if (editors.length > 1) return undefined
    parent = parent.parentElement
  }
  return undefined
}

type GuardDockProps = {
  ctx: Context
  sessionId: PropsRuntime<'conversation.input.dock'>['session']['sessionId']
  store: GuardConfigStore
  t: PropsLocale<typeof NS>['t']
}

/**
 * 宿主输入状态的读取面。
 * 实测宿主在相位切换期间会发出缺字段的中间态（`occurrences` 为 undefined），
 * 直接读 `.length` 会抛 TypeError 并从 keydown 逃逸，使 Enter 直接穿透。
 * 因此这里只声明插件真正用到的字段，且全部按可选处理。
 */
type PartialInputState = {
  readonly phase?: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly draft?: string
  readonly occurrences?: readonly unknown[]
  readonly imageIds?: readonly unknown[]
}

/**
 * 隐形输入扩展：只观察草稿与按键，不替换编辑器、不接管宿主其他键盘语义。
 *
 * 处置分工（见方案 §12.3 / §12.8）：
 * - block：拦下并给出原因；
 * - mask：拦下 + 就地打码 + 提示，或按 maskOnSubmit 只提示；
 * - 词条映射：拦下 + 就地改写，**全程静默**，不发任何提示。
 *
 * 配置从可热替换的配置源订阅：远程规则到达后重绑监听即可生效，无需重启宿主。
 */
export function GuardDock({ ctx, sessionId, store, t }: GuardDockProps) {
  const config = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const anchor = useRef<HTMLSpanElement>(null)
  const warned = useRef<Set<string>>(new Set())
  useEffect(() => {
    // 安装者装完插件后必须能从控制台判断死活，因此静默退让与成功挂载都要留痕。
    const reportOnce = (level: 'info' | 'warn', key: string, message: string): void => {
      if (warned.current.has(key)) return
      warned.current.add(key)
      if (level === 'info') console.info(message)
      else console.warn(message)
    }
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) {
      reportOnce('warn', 'session', '[michengai-input-guard] 当前会话输入状态未就绪，本次未挂载拦截。')
      return
    }
    const input = ctx.conversation.input.for(binding.ctx)
    const menu = ctx.inputTriggers.sessionOf(binding.ctx).menu
    const snapshot = (): PartialInputState => input.state.getSnapshot()
    let pendingPasteRewrite = false
    let editor: HTMLElement | undefined
    // 宿主的 notify 没有超时也没有清除接口，提示会一直挂着；这里自绘浮层，由插件控制 3 秒后隐藏。
    const owner = anchor.current?.ownerDocument ?? document
    const notice = new GuardNoticeLayer(owner)

    const notify = (level: GuardNoticeLevel, key: GuardNoticeKey, findings: readonly Finding[]): void => {
      notice.show(level, t(key, { rules: describeGuardRules(findingRuleIds(findings), t) }), editor)
    }
    // 含结构化引用或图片时 setDraft 会破坏宿主状态，必须整体退让。
    const busy = (): boolean => {
      const state = snapshot()
      return (state.phase !== undefined && state.phase !== 'plain')
        || (state.occurrences?.length ?? 0) > 0
        || (state.imageIds?.length ?? 0) > 0
        || menu.getSnapshot().open === true
    }
    // 供首次因繁忙放行时输出，便于实机区分是相位、引用、图片还是菜单。
    const describeBusy = (): string => {
      const state = snapshot()
      return `phase=${String(state.phase)} occurrences=${state.occurrences?.length ?? 0} images=${state.imageIds?.length ?? 0} menuOpen=${String(menu.getSnapshot().open)}`
    }
    const applyRewrite = (outcome: Extract<GuardOutcome, { kind: 'rewrite' }>): void => {
      input.setDraft(outcome.text)
      if (outcome.findings.length > 0) notify('info', 'guard.masked', outcome.findings)
      // 纯词条映射：静默改写，不弹提示、不写状态栏。
    }
    const onOutcome = (outcome: GuardOutcome, trigger: GuardTrigger): void => {
      if (outcome.kind === 'allow') return
      if (outcome.kind === 'block') {
        notify('error', trigger === 'paste' ? 'guard.pasteBlocked' : 'guard.blocked', outcome.findings)
        return
      }
      // 粘贴打码必须等文本真正落入编辑器后按整份草稿重算，避免只处理片段。
      if (trigger === 'paste') {
        pendingPasteRewrite = true
        return
      }
      if (outcome.findings.length > 0 && !config.maskOnSubmit) {
        notify('error', 'guard.askEdit', outcome.findings)
        return
      }
      applyRewrite(outcome)
    }

    const offState = input.state.subscribe(() => {
      const state = snapshot()
      // 宿主提交成功后草稿会清空：提示再保留 3 秒，避免刚看清就被收走。
      if (state.phase === 'plain' && (state.draft ?? '') === '') notice.hold(editor)
      if (!pendingPasteRewrite) return
      pendingPasteRewrite = false
      try {
        // 与 Enter 路径共用同一组互斥条件：菜单打开等情形下一律退让。
        if (busy()) return
        const outcome = guard(snapshot().draft ?? '', config)
        if (outcome.kind === 'rewrite') applyRewrite(outcome)
      } catch (error) {
        console.error('[michengai-input-guard] 粘贴后重算失败，本次不改写：', error)
      }
    })

    // undefined = 尚未查找过；null = 查找过但没找到。用以区分「首次失败」与「状态未变」。
    let last: HTMLElement | null | undefined
    let offKeys = (): void => {}
    const connect = (): void => {
      const next = anchor.current === null ? null : (findComposer(anchor.current) ?? null)
      if (last !== undefined && next === last) return
      last = next
      offKeys()
      editor = next ?? undefined
      if (editor === undefined) {
        reportOnce('warn', 'composer', '[michengai-input-guard] 未找到输入框，本次未挂载拦截。')
        return
      }
      offKeys = bindGuardKeys(editor, { draft: () => snapshot().draft ?? '', busy, describeBusy, onOutcome }, config)
      reportOnce('info', 'bound', '[michengai-input-guard] 已绑定输入框，拦截生效。')
    }
    connect()
    const parent = anchor.current?.parentElement?.parentElement
    const observer = new MutationObserver(connect)
    if (parent !== null && parent !== undefined) observer.observe(parent, { childList: true, subtree: true })
    return () => { observer.disconnect(); offKeys(); offState(); notice.dispose() }
  }, [config, ctx, sessionId, t])
  return <span ref={anchor} hidden />
}

/**
 * 注册输入框插槽。配置由 store 提供，而不是在注册时固化：
 * 注册必须立即完成（拦截不能有真空期），远程规则随后到达再热替换。
 */
export function registerInputGuard(ctx: Context, store: GuardConfigStore): void {
  function Dock(props: PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS>) {
    return <GuardDock ctx={ctx} sessionId={props.session.sessionId} store={store} t={props.t} />
  }
  ctx.slots.inject('conversation.input.dock', () => {
    // 工厂由宿主在插槽可用时调用，异常不会被外层捕获，必须就地留痕。
    try {
      const off = ctx.slots.register({
        name: 'conversation.input.dock', id: 'input-guard', order: -90, locale: NS, registrant: 'michengai-input-guard',
      }, Dock)
      console.info('[michengai-input-guard] 已注册输入框插槽。')
      return off
    } catch (error) {
      console.error('[michengai-input-guard] 注册输入框插槽失败：', error)
      return (): void => {}
    }
  })
}
