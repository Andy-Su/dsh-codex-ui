import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindGuardKeys, type GuardInterception, type GuardTrigger } from '../src/client/guard-keys.ts'
import { defaultGuardConfig, type GuardConfig, type GuardOutcome } from '../src/detect.ts'

type Seen = { outcome: GuardOutcome; trigger: GuardTrigger }

function setup(cfg: Partial<GuardConfig> = {}, initial: { draft: string; busy: boolean } = { draft: '', busy: false }) {
    const editor = document.createElement('textarea')
    document.body.append(editor)
    const state = { ...initial }
    const seen: Seen[] = []
    const interception: GuardInterception = {
        draft: () => state.draft,
        busy: () => state.busy,
        describeBusy: () => `phase=${state.busy ? 'submitting' : 'plain'}`,
        onOutcome: (outcome, trigger) => { seen.push({ outcome, trigger }) },
    }
    return {
        editor,
        state,
        seen,
        bind: () => bindGuardKeys(editor, interception, { ...defaultGuardConfig(), ...cfg }),
    }
}

function pressEnter(editor: HTMLElement, init: KeyboardEventInit = {}): boolean {
    return editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }))
}

function paste(editor: HTMLElement, text: string): boolean {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
    return editor.dispatchEvent(event)
}

const mappingConfig: Partial<GuardConfig> = { mappings: [{ from: '喵喵', to: '茄子', enabled: true }] }

beforeEach(() => {
    document.body.innerHTML = ''
    // 放行原因诊断只在实机定位时有用，测试期间静音；需要断言的用例读 spy。
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => { vi.restoreAllMocks() })

describe('Enter 提交路径', () => {
    it('命中凭证时拦下本次发送并上报命中', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        const submit = vi.fn()
        editor.addEventListener('keydown', submit)
        bind()
        expect(pressEnter(editor)).toBe(false)
        expect(seen).toHaveLength(1)
        expect(seen[0].trigger).toBe('submit')
        expect(seen[0].outcome.kind).toBe('block')
        expect(submit).not.toHaveBeenCalled()
    })

    it('命中可脱敏项时拦下发送并上报改写结果', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = '邮箱 alice@example.com'
        bind()
        expect(pressEnter(editor)).toBe(false)
        expect(seen[0].outcome).toMatchObject({ kind: 'rewrite', text: '邮箱 a***@example.com', reason: 'mask' })
    })

    it('命中词条映射时同样拦下，交由调用方改写后由用户再按一次', () => {
        const { editor, bind, seen, state } = setup(mappingConfig)
        state.draft = '前缀喵喵'
        bind()
        expect(pressEnter(editor)).toBe(false)
        expect(seen[0].outcome).toMatchObject({ kind: 'rewrite', text: '前缀茄子', reason: 'mapping', findings: [] })
    })

    it('无命中时完全放行，宿主提交照常触发', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = '普通提问'
        const submit = vi.fn()
        editor.addEventListener('keydown', submit)
        bind()
        expect(pressEnter(editor)).toBe(true)
        expect(seen).toEqual([])
        expect(submit).toHaveBeenCalledTimes(1)
    })

    it('输入法组合中不拦截', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        bind()
        expect(pressEnter(editor, { isComposing: true })).toBe(true)
        expect(seen).toEqual([])
    })

    it('组合开始后未结束时按下的 Enter 不拦截', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        bind()
        editor.dispatchEvent(new Event('compositionstart'))
        expect(pressEnter(editor)).toBe(true)
        expect(seen).toEqual([])
        editor.dispatchEvent(new Event('compositionend'))
        expect(pressEnter(editor)).toBe(false)
        expect(seen).toHaveLength(1)
    })

    it.each([
        ['Shift', { shiftKey: true }],
        ['Ctrl', { ctrlKey: true }],
        ['Meta', { metaKey: true }],
        ['Alt', { altKey: true }],
    ])('%s+Enter 不拦截（换行与快捷键归宿主）', (_name, init) => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        bind()
        expect(pressEnter(editor, init)).toBe(true)
        expect(seen).toEqual([])
    })

    it('相位繁忙或含结构化引用、图片时不拦截', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        state.busy = true
        bind()
        expect(pressEnter(editor)).toBe(true)
        expect(seen).toEqual([])
    })

    it('宿主在输入框上先注册提交处理器时仍能拦下本次发送', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        // 模拟宿主：先注册且提交时会 preventDefault。插件绑在 document 捕获，先于它执行。
        const submit = vi.fn()
        editor.addEventListener('keydown', event => { event.preventDefault(); submit() })
        bind()
        expect(pressEnter(editor)).toBe(false)
        expect(seen).toHaveLength(1)
        expect(seen[0].outcome.kind).toBe('block')
        expect(submit).not.toHaveBeenCalled()
    })

    it('更早注册的捕获处理器已处理时不重复拦截', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        const intercepted = (event: KeyboardEvent) => event.preventDefault()
        document.addEventListener('keydown', intercepted, true)
        try {
            bind()
            expect(pressEnter(editor)).toBe(false)
            expect(seen).toEqual([])
        } finally {
            document.removeEventListener('keydown', intercepted, true)
        }
    })

    it('输入框内部子元素上的 Enter 同样会被拦下', () => {
        const host = document.createElement('div')
        host.setAttribute('data-lexical-editor', 'true')
        host.setAttribute('contenteditable', 'true')
        const inner = document.createElement('span')
        host.append(inner)
        document.body.append(host)
        const seen: Seen[] = []
        const off = bindGuardKeys(host, {
            draft: () => 'AKIAIOSFODNN7EXAMPLE',
            busy: () => false,
            onOutcome: (outcome, trigger) => { seen.push({ outcome, trigger }) },
        }, defaultGuardConfig())
        try {
            expect(pressEnter(inner)).toBe(false)
            expect(seen).toHaveLength(1)
        } finally {
            off()
        }
    })

    it('其他输入面上的 Enter 不受影响', () => {
        const { bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        bind()
        const outside = document.createElement('input')
        document.body.append(outside)
        expect(pressEnter(outside)).toBe(true)
        expect(seen).toEqual([])
    })

    it('解绑后不再拦截', () => {
        const { editor, bind, seen, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        const off = bind()
        off()
        expect(pressEnter(editor)).toBe(true)
        expect(seen).toEqual([])
    })

    it('读取状态抛错时隔离异常并放行本次按键', () => {
        const editor = document.createElement('textarea')
        document.body.append(editor)
        const seen: Seen[] = []
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        const off = bindGuardKeys(editor, {
            draft: () => 'AKIAIOSFODNN7EXAMPLE',
            busy: () => { throw new TypeError("Cannot read properties of undefined (reading 'length')") },
            onOutcome: (outcome, trigger) => { seen.push({ outcome, trigger }) },
        }, defaultGuardConfig())
        try {
            expect(pressEnter(editor)).toBe(true)
            expect(seen).toEqual([])
            expect(error).toHaveBeenCalled()
        } finally {
            off()
            error.mockRestore()
        }
    })

    it('Enter 未拦截时按原因输出一次诊断，便于实机定位', () => {
        const { editor, bind, state } = setup()
        state.draft = '普通提问'
        bind()
        pressEnter(editor)
        pressEnter(editor)
        expect(vi.mocked(console.info)).toHaveBeenCalledTimes(1)
        const [message, detail] = vi.mocked(console.info).mock.calls[0]
        expect(String(message)).toContain('Enter 未拦截')
        expect(String(message)).toContain('未命中任何规则')
        // 只报长度，不把草稿内容写进控制台。
        expect(String(detail)).toBe('草稿长度=4')
    })

    it('相位繁忙时输出 busy 明细', () => {
        const { editor, bind, state } = setup()
        state.draft = 'AKIAIOSFODNN7EXAMPLE'
        state.busy = true
        bind()
        pressEnter(editor)
        const [message, detail] = vi.mocked(console.info).mock.calls[0]
        expect(String(message)).toContain('相位繁忙')
        expect(String(detail)).toContain('phase=')
    })
})

describe('粘贴路径', () => {
    it('粘贴凭证内容时取消本次粘贴并上报', () => {
        const { editor, bind, seen } = setup()
        const host = vi.fn()
        document.body.addEventListener('paste', host)
        bind()
        expect(paste(editor, 'AKIAIOSFODNN7EXAMPLE')).toBe(false)
        expect(seen[0]).toMatchObject({ trigger: 'paste' })
        expect(seen[0].outcome).toMatchObject({ kind: 'block' })
        expect(host).not.toHaveBeenCalled()
    })

    it('粘贴含可脱敏项时放行粘贴并上报，交由调用方按整篇草稿重算', () => {
        const { editor, bind, seen } = setup()
        bind()
        expect(paste(editor, 'alice@example.com')).toBe(true)
        expect(seen[0].outcome).toMatchObject({ kind: 'rewrite', text: 'a***@example.com', reason: 'mask' })
    })

    it('关闭粘贴打码后粘贴不再改写', () => {
        const { editor, bind, seen } = setup({ maskOnPaste: false })
        bind()
        expect(paste(editor, 'alice@example.com')).toBe(true)
        expect(seen).toEqual([])
    })

    it('关闭粘贴打码时映射也交给 Enter 兜底', () => {
        const { editor, bind, seen } = setup({ ...mappingConfig, maskOnPaste: false })
        bind()
        expect(paste(editor, '喵喵')).toBe(true)
        expect(seen).toEqual([])
    })

    it('纯文本以外的粘贴与干净文本不处理', () => {
        const { editor, bind, seen } = setup(mappingConfig)
        bind()
        expect(paste(editor, '')).toBe(true)
        expect(paste(editor, '普通粘贴')).toBe(true)
        expect(seen).toEqual([])
    })

    it('更早注册的捕获处理器已处理的粘贴不重复拦截', () => {
        const { editor, bind, seen } = setup()
        const intercepted = (event: Event) => event.preventDefault()
        document.addEventListener('paste', intercepted, true)
        try {
            bind()
            expect(paste(editor, 'AKIAIOSFODNN7EXAMPLE')).toBe(false)
            expect(seen).toEqual([])
        } finally {
            document.removeEventListener('paste', intercepted, true)
        }
    })
})
