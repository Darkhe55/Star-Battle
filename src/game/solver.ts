/**
 * 星之战 —— 回溯求解器
 */

import type { Puzzle, SolveResult } from '../core/types'
import { initialGrid, isValidSolution, propagate, solveByRules } from './rules.ts'
import { EMPTY, MARK, STAR, type StarPuzzle, type StarState } from './types.ts'

export interface CountOutcome {
  count: number
  nodes: number
  timedOut: boolean
}

function search(
  regions: ArrayLike<number>,
  stars: number,
  size: number,
  w: number,
  h: number,
  limit: number,
  maxNodes: number,
): { solutions: number[][]; nodes: number; timedOut: boolean } {
  const grid = initialGrid(size)
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false

  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    if (!propagate(grid, regions, stars, w, h)) return

    let choice = -1
    let best = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      const x = i % w
      const y = (i / w) | 0
      let score = 0
      if (x > 0 && grid[i - 1] !== EMPTY) score++
      if (x + 1 < w && grid[i + 1] !== EMPTY) score++
      if (y > 0 && grid[i - w] !== EMPTY) score++
      if (y + 1 < h && grid[i + w] !== EMPTY) score++
      if (score > best) {
        best = score
        choice = i
      }
    }
    if (choice < 0) {
      if (isValidSolution(grid, regions, stars, w, h)) solutions.push(Array.from(grid))
      return
    }

    const backup = Array.from(grid)
    for (const value of [STAR, MARK] as const) {
      if (solutions.length >= limit || timedOut) return
      grid[choice] = value
      dfs()
      for (let i = 0; i < size; i++) grid[i] = backup[i]!
    }
  }

  dfs()
  return { solutions, nodes, timedOut }
}

export function countSolutions(
  regions: ArrayLike<number>,
  stars: number,
  size: number,
  w: number,
  h: number,
  limit = 2,
  maxNodes = 400_000,
): CountOutcome {
  const out = search(regions, stars, size, w, h, limit, maxNodes)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}

/** 收集最多 limit 个解（用于生成器消除替代解） */
export function collectSolutions(
  regions: ArrayLike<number>,
  stars: number,
  size: number,
  w: number,
  h: number,
  limit = 3,
  maxNodes = 400_000,
): { solutions: number[][]; nodes: number; timedOut: boolean } {
  return search(regions, stars, size, w, h, limit, maxNodes)
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = puzzle as StarPuzzle
  const size = p.width * p.height
  if (!p.regions || p.regions.length !== size || !p.stars) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  for (const r of p.regions) {
    if (r < 0) return { solved: false, solution: null, nodes: 0, timedOut: false }
  }

  const byRules = solveByRules(p.regions, p.stars, size, p.width, p.height, true, 240)
  if (byRules.ok && byRules.solution) {
    return { solved: true, solution: makeState(p, byRules.solution), nodes: 0, timedOut: false }
  }
  if (byRules.contradiction) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }

  const out = search(p.regions, p.stars, size, p.width, p.height, 1, maxNodes)
  const solution = out.solutions[0]
  return {
    solved: !!solution,
    solution: solution ? makeState(p, solution) : null,
    nodes: out.nodes,
    timedOut: out.timedOut,
  }
}

export function makeState(puzzle: StarPuzzle, cells: number[]): StarState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: new Array<number>(puzzle.width * puzzle.height).fill(EMPTY),
  }
}
