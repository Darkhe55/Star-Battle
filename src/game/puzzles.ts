/**
 * 星之战 —— 题库加载
 */

import { RAW_PUZZLES } from './puzzles-data'
import {
  asStarPuzzle,
  decodeBoard,
  decodeCells,
  EMPTY,
  type StarPuzzle,
  type StarState,
} from './types'

export const builtinPuzzles: StarPuzzle[] = []
const solutions = new Map<string, number[]>()

for (const raw of RAW_PUZZLES) {
  const size = raw.width * raw.height
  const decoded = decodeBoard(raw.board, size)
  if (!decoded) {
    console.warn(`[星之战] 题面解码失败：${raw.id}`)
    continue
  }
  const puzzle: StarPuzzle = {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    regions: decoded.regions,
    stars: decoded.stars,
  }
  builtinPuzzles.push(puzzle)
  if (raw.solution) {
    const solution = decodeCells(raw.solution, size)
    if (solution) {
      puzzle.solution = solution
      solutions.set(raw.id, solution)
    }
  }
}

export function getReferenceSolution(id: string): StarState | null {
  const cells = solutions.get(id)
  if (!cells) return null
  const puzzle = builtinPuzzles.find((p) => p.id === id)
  if (!puzzle) return null
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: new Array<number>(puzzle.width * puzzle.height).fill(EMPTY),
  }
}

export function puzzleById(id: string): StarPuzzle | undefined {
  return builtinPuzzles.find((p) => p.id === id)
}

export function referenceFor(puzzle: StarPuzzle): number[] | null {
  return asStarPuzzle(puzzle).solution ?? solutions.get(puzzle.id) ?? null
}
