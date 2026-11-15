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

const VALUE_CYCLE: Array<number | null> = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9]

const custom: CustomSupport = {
  valueCycle: VALUE_CYCLE,

  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 9) return digit
    return undefined
  },

  cellLabel: (v) => (v == null ? '·' : String(v)),

  cellClass: (v) => (v == null ? '' : `r${v}`),

  hint: '数字 1-9 表示区域编号：在网格里画出区域，载入后每行每列每区域各放 1 颗星。',

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
