/**
 * 星之战（Star Battle）—— 游戏专用类型
 *
 * 规则：
 *   1. 每行、每列、每个粗线区域各放恰好 K 颗星；
 *   2. 任意两颗星不能横向、纵向或斜向相邻（八邻接）。
 *
 * 状态：0 = 未定，1 = 星，2 = 标记为空（×）。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const STAR = 1
export const MARK = 2

export type CellValue = 0 | 1 | 2

export interface StarPuzzle extends Puzzle {
  /** 每格所属区域号 */
  regions: number[]
  /** 每行/列/区域的星星数 K */
  stars: number
  /** 参考解：1 星 / 2 非星 */
  solution?: number[]
}

export interface StarState extends GameState {
  cells: number[]
  givens: number[]
}

export interface UnitIssue {
  kind: 'row' | 'col' | 'region'
  index: number
  stars: number
  target: number
}

export interface StarResult extends ValidationResult {
  empty: number
  complete: boolean
  starCount: number
  /** 八邻接的星星对数 */
  adjacentPairs: number
  adjacentCells: number[]
  unitIssues: UnitIssue[]
  regionCount: number
  /** 未划分区域的格数 */
  unassigned: number
  badCells: number[]
}

export function asStarPuzzle(p: Puzzle): StarPuzzle {
  return p as StarPuzzle
}

export function asStarState(s: GameState): StarState {
  return s as StarState
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 编码题面：每格一个区域字符（'.' = 未分配区域）+ 末尾一个 K 字符 */
export function encodeBoard(regions: ArrayLike<number>, stars: number): string {
  let out = ''
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]! | 0
    if (r < 0) out += '.'
    else out += r < BASE36.length ? BASE36[r]! : '0'
  }
  out += BASE36[Math.max(0, Math.min(BASE36.length - 1, stars | 0))]!
  return out
}

export function decodeBoard(
  text: string,
  expected: number,
): { regions: number[]; stars: number } | null {
  if (typeof text !== 'string' || text.length !== expected + 1) return null
  const regions = new Array<number>(expected).fill(-1)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '.') {
      regions[i] = -1
      continue
    }
    const v = BASE36.indexOf(ch.toLowerCase())
    if (v < 0) return null
    regions[i] = v
  }
  const stars = BASE36.indexOf(text[expected]!.toLowerCase())
  if (stars < 1) return null
  return { regions, stars }
}

export function normalizeRegions(regions: number[]): number[] {
  const map = new Map<number, number>()
  let next = 0
  const out: number[] = []
  for (const r of regions) {
    if (r < 0) {
      out.push(-1)
      continue
    }
    if (!map.has(r)) map.set(r, next++)
    out.push(map.get(r)!)
  }
  return out
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === '*' || ch === 'S' || ch === 's') out[i] = STAR
    else if (ch === '2' || ch === 'X' || ch === 'x' || ch === '-') out[i] = MARK
    else return null
  }
  return out
}
