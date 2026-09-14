/**
 * 内置默认词条映射（本地默认配置的一部分）。
 *
 * 用途：把内部产品名映射为水果/动物代号。用户提问里写到这些产品名时，
 * Enter 会被拦下并**静默**改写成代号，需再按一次 Enter 才会发出（B 路径语义）。
 *
 * 维护约定：
 * - `from` 唯一、且不存在 `from === to`（与 `normalizeGuardMapping` 的校验一致）；
 * - 存在包含关系时（`心水` ⊂ `心水收纳`、`可乐记账` ⊂ `可乐记账-鸿蒙`）无需排序：
 *   `substitute` 单次扫描 + 同起点取更长命中，天然保证长词优先；
 * - 清单是**打底**值：本机配置里同名 `from` 会覆盖它（可改目标或用 `enabled: false` 禁用），
 *   本机新增的条目追加在后。顺序不影响匹配结果，仅影响可读性。
 */
import type { GuardMapping } from './detect.ts'

export const DEFAULT_GUARD_MAPPINGS: readonly GuardMapping[] = [
    { from: '倒数321', to: '茄子', enabled: true },
    { from: '喵喵记账', to: '兰花', enabled: true },
    { from: 'Moo日记', to: '芒果', enabled: true },
    { from: '解忧娃娃', to: '椰子', enabled: true },
    { from: '专注崽崽', to: '南瓜', enabled: true },
    { from: '饭橘', to: '菠萝', enabled: true },
    { from: '阿柴记账', to: '牡丹', enabled: true },
    { from: '原子清单', to: '企鹅', enabled: true },
    { from: 'Miyoo', to: '橘子', enabled: true },
    { from: '阿柴记账-海外', to: '牡丹', enabled: true },
    { from: '凹凸计划', to: '辣椒', enabled: true },
    { from: 'herlog', to: '番茄', enabled: true },
    { from: '可乐记账', to: '海棠', enabled: true },
    { from: '面试无忧', to: '白菜', enabled: true },
    { from: '我的AI面试官', to: '胡萝卜', enabled: true },
    { from: '喵轻', to: '西瓜', enabled: true },
    { from: '初练瑜伽', to: '土豆', enabled: true },
    { from: 'Feel+', to: '葡萄', enabled: true },
    { from: 'Pick记账', to: '荷花', enabled: true },
    { from: '定格相机', to: '榴莲', enabled: true },
    { from: 'Speak Well', to: '黄瓜', enabled: true },
    { from: 'Gooh旅记', to: '水仙', enabled: true },
    { from: '西瓜小说', to: '河马', enabled: true },
    { from: '藏娇故事集', to: '浣熊', enabled: true },
    { from: 'Pop Screen', to: '黄瓜', enabled: true },
    { from: 'Ottopia', to: '比目鱼', enabled: true },
    { from: '小猫塔罗', to: '蓝莓', enabled: true },
    { from: 'Hitee', to: '梨子', enabled: true },
    { from: '心水收纳', to: '芹菜', enabled: true },
    { from: '远程相机', to: '草莓', enabled: true },
    { from: '心水', to: '洋葱', enabled: true },
    { from: '咕乐', to: '火龙果', enabled: true },
    { from: 'How睡眠', to: '长颈鹿', enabled: true },
    { from: 'MoneyUP', to: '茉莉', enabled: true },
    { from: '解压小羊', to: '柠檬', enabled: true },
    { from: '可乐记账-鸿蒙', to: '海棠', enabled: true },
    { from: 'Feel海外', to: '葡萄', enabled: true },
    { from: '清单盒子', to: '兔子', enabled: true },
    { from: 'CoupleSpace', to: '苹果', enabled: true },
    { from: '好眠科学', to: '熊猫', enabled: true },
    { from: '恰饭啦', to: '金针菇', enabled: true },
]
