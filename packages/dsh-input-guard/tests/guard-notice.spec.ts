import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUARD_NOTICE_VISIBLE_MS, GuardNoticeLayer } from '../src/client/guard-notice.ts'

const createLayer = (): GuardNoticeLayer => new GuardNoticeLayer(document)
const notice = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-dcu-guard-notice]')

beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
})

afterEach(() => { vi.useRealTimers() })

describe('提示浮层', () => {
    it('显示后 3 秒自动隐藏', () => {
        const layer = createLayer()
        layer.show('info', '已就地脱敏 手机号，确认后再发送。')
        expect(notice()?.textContent).toBe('已就地脱敏 手机号，确认后再发送。')
        expect(notice()?.dataset.dcuGuardNotice).toBe('info')
        vi.advanceTimersByTime(GUARD_NOTICE_VISIBLE_MS - 1)
        expect(notice()).not.toBeNull()
        vi.advanceTimersByTime(1)
        expect(notice()).toBeNull()
        layer.dispose()
    })

    it('重复显示复用同一个元素，并从最后一次显示重新计时', () => {
        const layer = createLayer()
        layer.show('info', '第一次')
        vi.advanceTimersByTime(2000)
        layer.show('info', '第二次')
        expect(document.querySelectorAll('[data-dcu-guard-notice]')).toHaveLength(1)
        expect(notice()?.textContent).toBe('第二次')
        vi.advanceTimersByTime(2000)
        expect(notice()).not.toBeNull()
        vi.advanceTimersByTime(1000)
        expect(notice()).toBeNull()
        layer.dispose()
    })

    it('未显示时 hold 不产生元素，已显示时只续期', () => {
        const layer = createLayer()
        layer.hold()
        expect(notice()).toBeNull()
        layer.show('error', '检测到 云访问密钥，已阻止发送。')
        vi.advanceTimersByTime(2000)
        layer.hold()
        vi.advanceTimersByTime(2000)
        expect(notice()).not.toBeNull()
        vi.advanceTimersByTime(1000)
        expect(notice()).toBeNull()
        layer.dispose()
    })

    it('dispose 立即清理元素与计时器', () => {
        const layer = createLayer()
        layer.show('info', '文案')
        expect(layer.visible).toBe(true)
        layer.dispose()
        expect(layer.visible).toBe(false)
        expect(notice()).toBeNull()
        vi.advanceTimersByTime(GUARD_NOTICE_VISIBLE_MS)
        expect(notice()).toBeNull()
    })

    it('错误级别用 alert、信息级别用 status，便于读屏区分', () => {
        const layer = createLayer()
        layer.show('error', '拦截')
        expect(notice()?.getAttribute('role')).toBe('alert')
        layer.show('info', '提示')
        expect(notice()?.getAttribute('role')).toBe('status')
        layer.dispose()
    })
})
