/** 自定义词条匹配：ASCII 词条按词边界匹配，中文等非 ASCII 词条按子串匹配。 */

export const GUARD_TERM_RULE_ID = 'custom-term'

export type TermSpan = { readonly start: number; readonly end: number }

const ASCII_ONLY = /^[\x20-\x7e]+$/

/** 词条可能含正则元字符，必须转义后再拼装。 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function indexOfAll(draft: string, needle: string): TermSpan[] {
    const spans: TermSpan[] = []
    let from = 0
    for (; ;) {
        const index = draft.indexOf(needle, from)
        if (index < 0) return spans
        spans.push({ start: index, end: index + needle.length })
        from = index + needle.length
    }
}

/**
 * 定位一个词条在草稿中的全部出现位置。
 * ASCII 词条忽略大小写但要求词边界，避免 `project` 命中 `projectx`；中文没有词边界概念，按子串匹配。
 */
export function matchGuardTerm(draft: string, term: string): TermSpan[] {
    const needle = term.trim()
    if (needle === '' || draft === '') return []
    if (!ASCII_ONLY.test(needle)) return indexOfAll(draft, needle)
    const pattern = new RegExp(`(?<!\\w)${escapeRegExp(needle)}(?!\\w)`, 'gi')
    return [...draft.matchAll(pattern)].map(match => ({
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
    }))
}
