/**
 * 星之战 —— 规则引擎
 */

import { EMPTY, MARK, STAR } from './types.ts'

export type RuleKind = 'adj' | 'count'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

const DX8 = [1, -1, 0, 0, 1, 1, -1, -1]
const DY8 = [0, 0, 1, -1, 1, -1, 1, -1]

export function neighbors8(index: number, w: number, h: number): number[] {
  const x = index % w
  const y = (index / w) | 0
  const out: number[] = []
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d]!
    const ny = y + DY8[d]!
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
    out.push(ny * w + nx)
  }
  return out
}

export function initialGrid(size: number): number[] {
  return new Array<number>(size).fill(EMPTY)
}

interface Unit {
  kind: 'row' | 'col' | 'region'
  cells: number[]
}

export function makeUnits(
  regions: ArrayLike<number>,
  w: number,
  h: number,
  regionCount: number,
): Unit[] {
  const units: Unit[] = []
  for (let y = 0; y < h; y++) {
    const cells: number[] = []
    for (let x = 0; x < w; x++) cells.push(y * w + x)
    units.push({ kind: 'row', cells })
  }
  for (let x = 0; x < w; x++) {
    const cells: number[] = []
    for (let y = 0; y < h; y++) cells.push(y * w + x)
    units.push({ kind: 'col', cells })
  }
  for (let r = 0; r < regionCount; r++) {
    const cells: number[] = []
    for (let i = 0; i < w * h; i++) if (regions[i] === r) cells.push(i)
    if (cells.length > 0) units.push({ kind: 'region', cells })
  }
  return units
}

export function propagate(
  cells: Int8Array | number[],
  regions: ArrayLike<number>,
  stars: number,
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  const size = w * h
  let regionCount = 0
  for (let i = 0; i < size; i++) {
    const r = regions[i] ?? -1
    if (r + 1 > regionCount) regionCount = r + 1
  }
  const units = makeUnits(regions, w, h, regionCount)
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== EMPTY) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  while (changed) {
    changed = false

    // 八邻接
    for (let i = 0; i < size; i++) {
      if (cells[i] !== STAR) continue
      for (const j of neighbors8(i, w, h)) {
        if (cells[j] === STAR) return false
        if (cells[j] === EMPTY && !set(j, MARK, 'adj')) return false
      }
    }

    // 行 / 列 / 区域计数
    for (const unit of units) {
      let starCount = 0
      let unknown = 0
      for (const i of unit.cells) {
        if (cells[i] === STAR) starCount++
        else if (cells[i] === EMPTY) unknown++
      }
      if (starCount > stars) return false
      if (starCount + unknown < stars) return false
      if (starCount === stars) {
        for (const i of unit.cells) {
          if (cells[i] === EMPTY && !set(i, MARK, 'count')) return false
        }
      } else if (starCount + unknown === stars) {
        for (const i of unit.cells) {
          if (cells[i] === EMPTY && !set(i, STAR, 'count')) return false
        }
      }
    }
  }

  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  regions: ArrayLike<number>,
  stars: number,
  w: number,
  h: number,
): boolean {
  const size = w * h
  let regionCount = 0
  for (let i = 0; i < size; i++) {
    if (cells[i] !== STAR && cells[i] !== MARK) return false
    const r = regions[i] ?? -1
    if (r + 1 > regionCount) regionCount = r + 1
  }

  const units = makeUnits(regions, w, h, regionCount)
  for (const unit of units) {
    let count = 0
    for (const i of unit.cells) if (cells[i] === STAR) count++
    if (count !== stars) return false
  }

  for (let i = 0; i < size; i++) {
    if (cells[i] !== STAR) continue
    for (const j of neighbors8(i, w, h)) {
      if (cells[j] === STAR) return false
    }
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  regions: ArrayLike<number>,
  stars: number,
  size: number,
  w: number,
  h: number,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const grid = initialGrid(size)
  let usedProbing = false

  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, regions, stars, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }

    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, regions, stars, w, h)
      return {
        ok,
        solution: ok ? solution : null,
        contradiction: false,
        saturated: ok,
        usedProbing,
      }
    }

    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }

    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let starImpossible = false
      let markImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = STAR
        if (!propagate(trial, regions, stars, w, h)) starImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = MARK
        if (!propagate(trial, regions, stars, w, h)) markImpossible = true
      }
      if (starImpossible && markImpossible) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (starImpossible !== markImpossible) {
        forced.push({ index: i, value: starImpossible ? MARK : STAR })
      }
    }

    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }

  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
