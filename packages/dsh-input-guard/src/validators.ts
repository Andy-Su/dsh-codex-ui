/**
 * 校验位与网段判定：把「长得像」提升到「确实是」，用于压低误报。
 * 全部为纯函数，无副作用，便于单测与复用。
 */

/** Luhn 校验（银行卡）。输入须已去掉空格与连字符。 */
export function luhnValid(digits: string): boolean {
    if (!/^\d{12,19}$/.test(digits)) return false
    let sum = 0
    let double = false
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        let value = digits.charCodeAt(index) - 48
        if (double) {
            value *= 2
            if (value > 9) value -= 9
        }
        sum += value
        double = !double
    }
    return sum % 10 === 0
}

const ID_CARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
const ID_CARD_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'] as const

/** 18 位身份证校验位（GB 11643-1999），避免把 18 位订单号判成身份证。 */
export function cnIdCardValid(value: string): boolean {
    const normalized = value.trim().toUpperCase()
    if (!/^\d{17}[\dX]$/.test(normalized)) return false
    let sum = 0
    for (let index = 0; index < 17; index += 1) {
        sum += (normalized.charCodeAt(index) - 48) * (ID_CARD_WEIGHTS[index] ?? 0)
    }
    return ID_CARD_CHECK_CODES[sum % 11] === normalized[17]
}

/** 仅判定 RFC1918 私网地址；公网地址不拦，避免干扰正常排障。 */
export function isPrivateIpv4(value: string): boolean {
    const parts = value.split('.')
    if (parts.length !== 4) return false
    const octets: number[] = []
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return false
        const octet = Number(part)
        if (octet > 255) return false
        octets.push(octet)
    }
    const [first, second] = octets as [number, number, number, number]
    if (first === 10) return true
    if (first === 172) return second >= 16 && second <= 31
    return first === 192 && second === 168
}

/** 中国固定电话区号：`010` / `02x`（三位）或 `0[3-9]xx`（四位）。 */
const CN_LANDLINE_AREA = /^0(?:10|2\d|[3-9]\d{2})/

/**
 * 返回合法区号（含前导 0），非法或位数不符时返回 undefined。
 * 识别串本身已要求至少一处分隔符，这里再收紧区号与位数，避免撞上以 0 开头的账号。
 */
export function cnLandlineAreaCode(value: string): string | undefined {
    const digits = value.replace(/\D/g, '')
    const area = CN_LANDLINE_AREA.exec(digits)
    if (area === null) return undefined
    const rest = digits.length - area[0].length
    return rest === 7 || rest === 8 ? area[0] : undefined
}

export function isCnLandline(value: string): boolean {
    return cnLandlineAreaCode(value) !== undefined
}

/**
 * 常见公开客服短号（运营商/银行/物流）。五位纯数字误报成本高，
 * 因此只认白名单；需要更多号码时在配置里用自定义词条补充。
 */
const CN_SERVICE_SHORT_NUMBERS = new Set([
    '10000', '10010', '10086', '95188', '95338', '95511',
    '95533', '95555', '95566', '95588', '95599',
])

/** 服务号：400/800 按「三位 + 七位」结构判定，五位短号只认白名单。 */
export function isCnServiceNumber(value: string): boolean {
    const digits = value.replace(/\D/g, '')
    return CN_SERVICE_SHORT_NUMBERS.has(digits) || /^[48]00\d{7}$/.test(digits)
}
