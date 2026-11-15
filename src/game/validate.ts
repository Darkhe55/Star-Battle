/**
 * 星之战 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { makeUnits, neighbors8 } from './rules'
import {
  asStarPuzzle,
  asStarState,
  EMPTY,
  STAR,
  type StarResult,
  type UnitIssue,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): StarResult {
  const s = asStarState(state)
  const p = asStarPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const regions = p.regions ?? []
  const target = p.stars ?? 0

  let empty = 0
  let starCount = 0
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    else if (cells[i] === STAR) starCount++
  }

  let regionCount = 0
  let unassigned = 0
  for (const r of regions) {
    if (r < 0) unassigned++
    else if (r + 1 > regionCount) regionCount = r + 1
  }

  const bad = new Set<number>()
  if (unassigned > 0) {
    for (let i = 0; i < size; i++) if ((regions[i] ?? -1) < 0) bad.add(i)
  }

  let adjacentPairs = 0
  const adjacent = new Set<number>()
  for (let i = 0; i < size; i++) {
    if (cells[i] !== STAR) continue
    for (const j of neighbors8(i, w, h)) {
      if (j < i) continue
      if (cells[j] === STAR) {
        adjacentPairs++
        adjacent.add(i)
        adjacent.add(j)
      }
    }
  }
  for (const i of adjacent) bad.add(i)

  const units = makeUnits(regions, w, h, regionCount)
  const unitIssues: UnitIssue[] = []
  for (const unit of units) {
    let stars = 0
    let unknown = 0
    for (const i of unit.cells) {
      if (cells[i] === STAR) stars++
      else if (cells[i] === EMPTY) unknown++
    }
    const impossible = stars + unknown < target
    const complete = unknown === 0
    if (stars > target || impossible || (complete && stars !== target)) {
      unitIssues.push({ kind: unit.kind, index: 0, stars, target })
      if (complete || impossible) {
        for (const i of unit.cells) bad.add(i)
      }
    }
  }

  const solved =
    unassigned === 0 &&
    adjacentPairs === 0 &&
    unitIssues.length === 0 &&
    units.every((unit) => {
      let stars = 0
      for (const i of unit.cells) if (cells[i] === STAR) stars++
      return stars === target
    })

  return {
    solved,
    empty,
    complete: empty === 0,
    starCount,
    adjacentPairs,
    adjacentCells: Array.from(adjacent),
    unitIssues,
    regionCount,
    unassigned,
    badCells: Array.from(bad),
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as StarResult
  if (r.solved) return ['完成']

  const bits: string[] = []
  if (r.unassigned > 0) bits.push(`${r.unassigned} 格未划分区域`)
  if (r.adjacentPairs > 0) bits.push(`${r.adjacentPairs} 对星星相邻`)
  for (const issue of r.unitIssues.slice(0, 3)) {
    const label = issue.kind === 'row' ? '行' : issue.kind === 'col' ? '列' : '区域'
    bits.push(`${label}星星数 ${issue.stars}/${issue.target}`)
  }
  if (r.unitIssues.length > 3) bits.push(`等 ${r.unitIssues.length} 处不满足`)
  if (bits.length === 0) {
    if (r.starCount === 0) bits.push('开始放星星')
    else bits.push(`已放 ${r.starCount} 颗星`)
  }
  return bits
}
