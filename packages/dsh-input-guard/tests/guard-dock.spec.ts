import { createRequire } from 'node:module'
import { act, createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { GuardDock } from '../src/client/guard-dock.tsx'
import { GuardConfigStore } from '../src/config-store.ts'
import { defaultGuardConfig, type GuardConfig } from '../src/detect.ts'
import { zh } from '../src/locales.ts'

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (el: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void }
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const dict = zh as unknown as Record<string, string>
const t = (key: string, params?: Record<string, unknown>): string => {
  const text = dict[key] ?? key
  return params === undefined ? text : text.replace(/\{(\w+)\}/g, (_all, name: string) => String(params[name] ?? ''))
}

type FakeState = {
  draft: string
  imageIds: string[]
  occurrences: unknown[]
  phase: 'plain' | 'submitting'
}

type HarnessOptions = { binding?: 'ready' | 'missing'; composer?: 'present' | 'absent'; partialState?: boolean }

async function mountHarness(patch: Partial<GuardConfig> = {}, options: HarnessOptions = {}) {
  document.body.innerHTML = options.composer === 'absent'
    ? '<div class="composer"><div id="seat"></div></div>'
    : '<div class="composer"><div id="seat"></div><textarea></textarea></div>'
  const listeners = new Set<() => void>()
  const state: FakeState = { draft: '', imageIds: [], occurrences: [], phase: 'plain' }
  const setDraft = vi.fn((text: string) => {
    state.draft = text
    for (const listener of [...listeners]) listener()
  })
  const notify = vi.fn()
  const menu = { open: false }
  const input = {
    state: {
      // 宿主在相位切换期间可能只发出部分字段（实测 `occurrences` 缺失会让插件崩溃）。
      getSnapshot: () => (options.partialState === true
        ? { draft: state.draft, phase: state.phase }
        : { ...state }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    setDraft,
    notify,
  }
  const ctx = {
    sessions: { binding: () => (options.binding === 'missing' ? undefined : { ctx: {} }) },
    conversation: { input: { for: () => input } },
    inputTriggers: { sessionOf: () => ({ menu: { getSnapshot: () => menu } }) },
  } as unknown as Context
  const root = createRoot(document.querySelector('#seat')!)
  const store = new GuardConfigStore({ ...defaultGuardConfig(), ...patch })
  await act(async () => {
    root.render(createElement(GuardDock, { ctx, sessionId, store, t }))
  })
  const editor = document.querySelector('textarea')!
  return {
    state,
    setDraft,
    notify,
    menu,
    editor,
    store,
    emit: () => { for (const listener of [...listeners]) listener() },
    unmount: () => act(async () => { root.unmount() }),
  }
}

function pressEnter(editor: HTMLElement): boolean {
  return editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

function paste(editor: HTMLElement, text: string): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  return editor.dispatchEvent(event)
}

/** 插件自绘的提示浮层：宿主 notify 无法定时隐藏，因此不再使用它。 */
const noticeElement = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-dcu-guard-notice]')
const noticeText = (): string => noticeElement()?.textContent ?? ''
const noticeLevel = (): string => noticeElement()?.dataset.dcuGuardNotice ?? ''

const mappingConfig: Partial<GuardConfig> = { mappings: [{ from: '喵喵', to: '茄子', enabled: true }] }

/** 品牌化的会话标识，测试里只需一个稳定字符串。 */
const sessionId = 's1' as Parameters<typeof GuardDock>[0]['sessionId']

beforeEach(() => {
  document.body.innerHTML = ''
  // 诊断输出只用于实机定位，测试期间静音以免刷屏；需要断言的用例自会读取 spy。
  vi.spyOn(console, 'info').mockImplementation(() => { })
})

// 不复位会跨用例累积调用次数，使「只输出一次」这类断言失真。
afterEach(() => { vi.restoreAllMocks() })

describe('配置热替换', () => {
  it('替换配置源后立即按新规则拦截，无需重挂组件', async () => {
    const dock = await mountHarness()
    dock.state.draft = '这是机密内容'
    // 本地规则不含该词条，此时应当放行。
    expect(pressEnter(dock.editor)).toBe(true)

    await act(async () => {
      dock.store.replace({ ...defaultGuardConfig(), terms: ['机密'], termAction: 'block' })
    })

    expect(pressEnter(dock.editor)).toBe(false)
    expect(dock.setDraft).not.toHaveBeenCalled()
    expect(noticeLevel()).toBe('error')
  })

  it('热替换后的映射规则对粘贴路径同样生效', async () => {
    const dock = await mountHarness()
    await act(async () => {
      dock.store.replace({ ...defaultGuardConfig(), mappings: [{ from: '喵喵', to: '茄子', enabled: true }] })
    })

    // 粘贴本就先放行，待宿主草稿落地后再按整篇改写。
    expect(paste(dock.editor, '喵喵')).toBe(true)
    dock.state.draft = '喵喵'
    dock.emit()
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('茄子')
  })
})

describe('提交路径（B）', () => {
  it('命中词条映射时静默改写草稿，不发送也不提示', async () => {
    const dock = await mountHarness(mappingConfig)
    dock.state.draft = '前缀喵喵'
    expect(pressEnter(dock.editor)).toBe(false)
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('前缀茄子')
    expect(noticeElement()).toBeNull()
  })

  it('改写后第二次 Enter 正常交给宿主发送', async () => {
    const dock = await mountHarness(mappingConfig)
    dock.state.draft = '喵喵'
    pressEnter(dock.editor)
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('茄子')
    expect(pressEnter(dock.editor)).toBe(true)
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('茄子')
    expect(noticeElement()).toBeNull()
  })

  it('命中凭证时阻止发送并说明规则', async () => {
    const dock = await mountHarness()
    dock.state.draft = 'key=AKIAIOSFODNN7EXAMPLE'
    expect(pressEnter(dock.editor)).toBe(false)
    expect(dock.notify).not.toHaveBeenCalled()
    expect(noticeLevel()).toBe('error')
    expect(noticeText()).toBe('检测到 云访问密钥，已阻止发送。请移除后重试。')
    expect(dock.setDraft).not.toHaveBeenCalled()
  })

  it('命中可脱敏项时就地打码并提示确认', async () => {
    const dock = await mountHarness()
    dock.state.draft = '邮箱 alice@example.com'
    expect(pressEnter(dock.editor)).toBe(false)
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('邮箱 a***@example.com')
    expect(noticeLevel()).toBe('info')
    expect(noticeText()).toBe('已就地脱敏 邮箱，确认后再发送。')
  })

  it('关闭就地打码后只提示、不改写草稿', async () => {
    const dock = await mountHarness({ maskOnSubmit: false })
    dock.state.draft = '邮箱 alice@example.com'
    expect(pressEnter(dock.editor)).toBe(false)
    expect(dock.setDraft).not.toHaveBeenCalled()
    expect(noticeLevel()).toBe('error')
    expect(noticeText()).toBe('检测到 邮箱，已阻止发送。请修改后再发送。')
  })

  it('相位繁忙、含结构化引用或图片、触发菜单打开时全部放行', async () => {
    const dock = await mountHarness()
    dock.state.draft = 'key=AKIAIOSFODNN7EXAMPLE'
    dock.state.phase = 'submitting'
    expect(pressEnter(dock.editor)).toBe(true)
    dock.state.phase = 'plain'
    dock.state.occurrences = [{ occurrenceId: 1 }]
    expect(pressEnter(dock.editor)).toBe(true)
    dock.state.occurrences = []
    dock.state.imageIds = ['image']
    expect(pressEnter(dock.editor)).toBe(true)
    dock.state.imageIds = []
    dock.menu.open = true
    expect(pressEnter(dock.editor)).toBe(true)
    expect(dock.setDraft).not.toHaveBeenCalled()
    expect(noticeElement()).toBeNull()
  })

  it('卸载后不再订阅或拦截', async () => {
    const dock = await mountHarness()
    dock.state.draft = 'key=AKIAIOSFODNN7EXAMPLE'
    await dock.unmount()
    expect(pressEnter(dock.editor)).toBe(true)
    expect(noticeElement()).toBeNull()
  })

  it('宿主状态缺少 occurrences/imageIds 时仍能正常拦截', async () => {
    const dock = await mountHarness({}, { partialState: true })
    dock.state.draft = '手机号 13800138000'
    expect(pressEnter(dock.editor)).toBe(false)
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('手机号 138****8000')
    expect(noticeLevel()).toBe('info')
    expect(noticeText()).toBe('已就地脱敏 手机号，确认后再发送。')
  })

  it('提示由插件自绘浮层承担，不再写入宿主提示列表', async () => {
    const dock = await mountHarness()
    dock.state.draft = '邮箱 alice@example.com'
    expect(pressEnter(dock.editor)).toBe(false)
    expect(dock.notify).not.toHaveBeenCalled()
    expect(noticeElement()).not.toBeNull()
  })

  it('宿主提交成功（草稿清空）后提示仍在，直到自身 3 秒到期', async () => {
    const dock = await mountHarness()
    dock.state.draft = '邮箱 alice@example.com'
    pressEnter(dock.editor)
    dock.state.draft = ''
    dock.emit()
    expect(noticeElement()).not.toBeNull()
  })
})

describe('粘贴路径（C）', () => {
  it('粘贴凭证内容时取消粘贴并提示', async () => {
    const dock = await mountHarness()
    expect(paste(dock.editor, 'AKIAIOSFODNN7EXAMPLE')).toBe(false)
    expect(noticeLevel()).toBe('error')
    expect(noticeText()).toBe('粘贴内容包含 云访问密钥，已取消本次粘贴。')
  })

  it('粘贴含可脱敏项时先落地，再按整篇草稿改写', async () => {
    const dock = await mountHarness()
    expect(paste(dock.editor, 'alice@example.com')).toBe(true)
    expect(dock.setDraft).not.toHaveBeenCalled()
    dock.state.draft = '联系方式 alice@example.com'
    dock.emit()
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('联系方式 a***@example.com')
    expect(noticeLevel()).toBe('info')
    expect(noticeText()).toBe('已就地脱敏 邮箱，确认后再发送。')
  })

  it('粘贴命中词条映射时静默改写，不发任何提示', async () => {
    const dock = await mountHarness(mappingConfig)
    expect(paste(dock.editor, '喵喵')).toBe(true)
    dock.state.draft = '喵喵'
    dock.emit()
    expect(dock.setDraft).toHaveBeenCalledExactlyOnceWith('茄子')
    expect(dock.notify).not.toHaveBeenCalled()
  })

  it('关闭粘贴打码后粘贴不改写', async () => {
    const dock = await mountHarness({ ...mappingConfig, maskOnPaste: false })
    expect(paste(dock.editor, '喵喵 alice@example.com')).toBe(true)
    dock.state.draft = '喵喵 alice@example.com'
    dock.emit()
    expect(dock.setDraft).not.toHaveBeenCalled()
    expect(noticeElement()).toBeNull()
  })

  it('粘贴落地时若已含结构化引用则不改写', async () => {
    const dock = await mountHarness()
    paste(dock.editor, 'alice@example.com')
    dock.state.draft = 'alice@example.com'
    dock.state.occurrences = [{ occurrenceId: 2 }]
    dock.emit()
    expect(dock.setDraft).not.toHaveBeenCalled()
  })
})

describe('诊断', () => {
  it('会话未就绪时输出一次警告且不挂载拦截', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
    try {
      const dock = await mountHarness({}, { binding: 'missing' })
      dock.state.draft = 'key=AKIAIOSFODNN7EXAMPLE'
      expect(pressEnter(dock.editor)).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('未就绪')
      expect(noticeElement()).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  it('找不到输入框时输出一次警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
    try {
      await mountHarness({}, { composer: 'absent' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('未找到输入框')
    } finally {
      warn.mockRestore()
    }
  })

  it('绑定输入框成功后输出一次提示，重复渲染不重复输出', async () => {
    const dock = await mountHarness()
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(console.info).mock.calls[0][0])).toContain('已绑定输入框')
    await dock.unmount()
  })
})
