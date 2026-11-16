/**
 * ════════════════════════════════════════════════════════════════════
 *  星之战（Star Battle）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：
 *   1. 每行、每列、每个粗线区域各放恰好 K 颗星；
 *   2. 任意两颗星不能八邻接。
 *
 * 状态用 0/1/2：0 = 未定，1 = 星，2 = 标记为空。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  decodeBoard,
  encodeBoard,
  normalizeRegions,
  STAR,
  type StarPuzzle,
} from './types'

const meta = {
  title: '星之战',
  tagline: '每行每列每区域各放 K 颗星 —— 星星之间互不八邻接',
  footerNote:
    '规则：每行、每列、每个粗线区域各放恰好 K 颗星；任意两颗星不能横向、纵向或斜向相邻。数字 K 显示在题目信息中。',
  storageKeyPrefix: 'star-battle',
  customIdPrefix: 'star-battle-custom-',
  customMinW: 5,
  customMinH: 5,
  customMaxW: 30,
  customMaxH: 30,
}

/** 区域编号上限：base36 编码的题面支持 0..35，自定义题板用 1..35 号区域（1-9 数字键 / a-z 字母键直填） */
const MAX_REGION = 35
const VALUE_CYCLE: Array<number | null> = [null, ...Array.from({ length: MAX_REGION }, (_, i) => i + 1)]

/** 区域号 → 编辑器显示：1-9 用数字，10-35 用小写字母 */
function regionLabel(v: number | null): string {
  if (v == null) return '·'
  if (v <= 9) return String(v)
  return String.fromCharCode('a'.charCodeAt(0) + (v - 10))
}

const custom: CustomSupport = {
  valueCycle: VALUE_CYCLE,

  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 9) return digit
    return undefined
  },

  /** 字母键 a-z 直填 10..35 号区域（10×10 以上的星之战题板区域数会超过 9） */
  keyForChar: (ch) => {
    const v = ch.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0)
    if (v < 0 || v >= 26) return undefined
    return 10 + v
  },

  cellLabel: (v) => regionLabel(v),

  cellClass: (v) => (v == null ? '' : `r${v}`),

  hint: '数字 1-9 表示区域编号；棋盘大于 9×9 时区域数会超过 9，用字母键 a-z 直填 10-35 号区域（点格循环 空→1→2…→35）。载入后每行每列每区域各放 K 颗星。',

  toGrid: (p) => {
    const regions = (p as StarPuzzle).regions
    if (!Array.isArray(regions) || regions.length !== p.width * p.height) return null
    return {
      width: p.width,
      height: p.height,
      grid: regions.map((r) => (typeof r === 'number' && r >= 0 ? r + 1 : null)),
    }
  },

  makePuzzle: (w, h, grid, existingId) => {
    const raw = grid.map((v) => (typeof v === 'number' && v >= 1 ? v : -1))
    const starsEl = document.getElementById('custom-stars') as HTMLSelectElement | null
    const stars = Math.max(1, Math.min(7, Number(starsEl?.value) || 1))
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h} · 每单位 ${stars} 星`,
      width: w,
      height: h,
      difficulty: 'custom',
      regions: normalizeRegions(raw),
      stars,
    } satisfies StarPuzzle
  },

  encodePuzzle: (p) => {
    const sp = p as StarPuzzle
    return { board: encodeBoard(sp.regions ?? [], sp.stars ?? 1) }
  },

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    if (typeof record.board !== 'string') return null
    const decoded = decodeBoard(record.board, w * h)
    if (!decoded) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      regions: decoded.regions,
      stars: decoded.stars,
    } satisfies StarPuzzle
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.to === STAR) playPluck(streak, 1.15)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
