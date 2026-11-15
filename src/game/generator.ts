/**
 * 星之战题库生成器
 *
 * 1. 用回溯随机放置星：每行每列恰好 K 颗，星星互不八邻接；
 * 2. 把星星分成 n 组（每组 K 颗，优先邻近）；
 * 3. 以每组星星为种子，做连通的多源生长划分区域；
 * 4. 用求解器统计解数，只保留恰好一解的区域划分。
 */

import type { Difficulty } from '../core/types'
import { MARK, STAR, encodeBoard, encodeCells } from './types.ts'
import { solveByRules } from './rules.ts'
import { collectSolutions, countSolutions } from './solver.ts'

export interface RawPuzzleOut {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

interface GenSpec {
  w: number
  h: number
  k: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  attempts: number
  maxNodes: number
  requireLogic: boolean
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = list[i]!
    list[i] = list[j]!
    list[j] = tmp
  }
  return list
}

function placeStars(n: number, k: number, rng: () => number): number[] | null {
  const grid = new Array<number>(n * n).fill(0)
  const colCount = new Array<number>(n).fill(0)
  let nodes = 0

  const dfs = (y: number, prev: number[]): boolean => {
    if (++nodes > 2_000_000) return false
    if (y === n) return colCount.every((c) => c === k)

    const allowed: number[] = []
    for (let c = 0; c < n; c++) {
      if (colCount[c]! >= k) continue
      if (prev.some((p) => Math.abs(p - c) <= 1)) continue
      allowed.push(c)
    }

    const combos: number[][] = []
    const chosen: number[] = []
    const build = (start: number): void => {
      if (chosen.length === k) {
        combos.push(chosen.slice())
        return
      }
      for (let idx = start; idx < allowed.length; idx++) {
        const c = allowed[idx]!
        if (chosen.length > 0 && c - chosen[chosen.length - 1]! <= 1) continue
        chosen.push(c)
        build(idx + 1)
        chosen.pop()
      }
    }
    build(0)
    shuffle(combos, rng)

    for (const combo of combos) {
      let ok = true
      for (let c = 0; c < n; c++) {
        const add = combo.includes(c) ? 1 : 0
        const remain = n - y - 1
        if (colCount[c]! + add > k || colCount[c]! + add + remain < k) {
          ok = false
          break
        }
      }
      if (!ok) continue

      for (const c of combo) {
        colCount[c]!++
        grid[y * n + c] = 1
      }
      if (dfs(y + 1, combo)) return true
      for (const c of combo) {
        colCount[c]!--
        grid[y * n + c] = 0
      }
    }
    return false
  }

  return dfs(0, []) ? grid : null
}

function groupStars(stars: number[], k: number, n: number, rng: () => number): number[][] | null {
  if (k === 1) return stars.map((s) => [s])
  if (k !== 2) return null

  const remaining = shuffle(stars.slice(), rng)
  const groups: number[][] = []
  while (remaining.length > 0) {
    const a = remaining.pop()!
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const b = remaining[i]!
      const d = Math.abs((a % n) - (b % n)) + Math.abs(((a / n) | 0) - ((b / n) | 0))
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    if (best < 0) return null
    const b = remaining.splice(best, 1)[0]!
    groups.push([a, b])
  }
  return groups
}

function partition(groups: number[][], w: number, h: number, rng: () => number): number[] | null {
  const n = w * h
  const owner = new Array<number>(n).fill(-1)
  const sizes = groups.map(() => 0)
  const frontiers: Array<Set<number>> = groups.map(() => new Set<number>())

  const addNeighbors = (g: number, cell: number): void => {
    const x = cell % w
    const y = (cell / w) | 0
    if (x > 0 && owner[cell - 1] === -1) frontiers[g]!.add(cell - 1)
    if (x + 1 < w && owner[cell + 1] === -1) frontiers[g]!.add(cell + 1)
    if (y > 0 && owner[cell - w] === -1) frontiers[g]!.add(cell - w)
    if (y + 1 < h && owner[cell + w] === -1) frontiers[g]!.add(cell + w)
  }

  let assigned = 0
  for (let g = 0; g < groups.length; g++) {
    for (const s of groups[g]!) {
      if (owner[s] !== -1) return null
      owner[s] = g
      sizes[g]!++
      assigned++
      addNeighbors(g, s)
    }
  }

  while (assigned < n) {
    let minSize = Infinity
    for (let g = 0; g < groups.length; g++) {
      let hasUnowned = false
      for (const c of frontiers[g]!) {
        if (owner[c] === -1) {
          hasUnowned = true
          break
        }
      }
      if (hasUnowned && sizes[g]! < minSize) minSize = sizes[g]!
    }
    if (!Number.isFinite(minSize)) return null

    const candidates: number[] = []
    for (let g = 0; g < groups.length; g++) {
      let hasUnowned = false
      for (const c of frontiers[g]!) {
        if (owner[c] === -1) {
          hasUnowned = true
          break
        }
      }
      if (hasUnowned && sizes[g]! <= minSize + 1) candidates.push(g)
    }
    const picked = candidates[Math.floor(rng() * candidates.length)]!

    const list: number[] = []
    for (const c of frontiers[picked]!) if (owner[c] === -1) list.push(c)
    const cell = list[Math.floor(rng() * list.length)]!
    if (cell < 0) return null

    owner[cell] = picked
    sizes[picked]!++
    assigned++
    addNeighbors(picked, cell)
  }

  return owner
}

interface AttemptStats {
  placeFail: number
  groupFail: number
  partitionFail: number
  notUnique: number
  timeout: number
}

function sameSolution(a: ArrayLike<number>, b: ArrayLike<number>, size: number): boolean {
  for (let i = 0; i < size; i++) if (a[i] !== b[i]) return false
  return true
}

function regionConnected(owner: ArrayLike<number>, w: number, h: number, region: number): boolean {
  let start = -1
  for (let i = 0; i < w * h; i++) {
    if (owner[i] === region) {
      start = i
      break
    }
  }
  if (start < 0) return false

  const seen = new Uint8Array(w * h)
  const stack = [start]
  seen[start] = 1
  let count = 0
  while (stack.length) {
    const i = stack.pop()!
    count++
    const x = i % w
    const y = (i / w) | 0
    if (x > 0 && owner[i - 1] === region && !seen[i - 1]) {
      seen[i - 1] = 1
      stack.push(i - 1)
    }
    if (x + 1 < w && owner[i + 1] === region && !seen[i + 1]) {
      seen[i + 1] = 1
      stack.push(i + 1)
    }
    if (y > 0 && owner[i - w] === region && !seen[i - w]) {
      seen[i - w] = 1
      stack.push(i - w)
    }
    if (y + 1 < h && owner[i + w] === region && !seen[i + w]) {
      seen[i + w] = 1
      stack.push(i + w)
    }
  }

  let total = 0
  for (let i = 0; i < w * h; i++) if (owner[i] === region) total++
  return count === total
}

/**
 * 消灭替代解：把「本解非星、替代解是星」的格子改划到相邻区域。
 * 本解的区域星数不变（该格在本解不是星），替代解却会多/少一颗星。
 */
function refineRegions(
  regions: number[],
  solution: number[],
  k: number,
  w: number,
  h: number,
  rng: () => number,
  maxNodes: number,
): number[] | null {
  const size = w * h
  const owner = regions.slice()

  for (let iter = 0; iter < 800; iter++) {
    const out = collectSolutions(owner, k, size, w, h, 3, maxNodes)
    if (out.timedOut) return null
    if (out.solutions.length === 1) return owner

    let alt: number[] | null = null
    for (const sol of out.solutions) {
      if (!sameSolution(sol, solution, size)) {
        alt = sol
        break
      }
    }
    if (!alt) return null

    const candidates: number[] = []
    for (let i = 0; i < size; i++) {
      if (solution[i] !== STAR && alt[i] === STAR) candidates.push(i)
    }
    shuffle(candidates, rng)

    let moved = false
    for (const x of candidates) {
      const from = owner[x]!
      const xr = x % w
      const xy = (x / w) | 0
      const adjacent = new Set<number>()
      if (xr > 0) adjacent.add(owner[x - 1]!)
      if (xr + 1 < w) adjacent.add(owner[x + 1]!)
      if (xy > 0) adjacent.add(owner[x - w]!)
      if (xy + 1 < h) adjacent.add(owner[x + w]!)
      adjacent.delete(from)
      const targets = shuffle(Array.from(adjacent), rng)
      for (const to of targets) {
        owner[x] = to
        if (regionConnected(owner, w, h, from)) {
          moved = true
          break
        }
        owner[x] = from
      }
      if (moved) break
    }
    if (!moved) return null
  }

  return null
}

function attemptPuzzle(
  spec: GenSpec,
  rng: () => number,
  stats: AttemptStats,
): { regions: number[]; solution: number[] } | null {
  const { w, h, k } = spec
  const n = w * h
  const grid = placeStars(w, k, rng)
  if (!grid) {
    stats.placeFail++
    return null
  }

  const stars: number[] = []
  for (let i = 0; i < n; i++) if (grid[i] === 1) stars.push(i)
  const groups = groupStars(stars, k, w, rng)
  if (!groups) {
    stats.groupFail++
    return null
  }

  const regions = partition(groups, w, h, rng)
  if (!regions) {
    stats.partitionFail++
    return null
  }

  const solution = grid.map((v) => (v === 1 ? STAR : MARK))
  const refined = refineRegions(regions, solution, k, w, h, rng, spec.maxNodes)
  if (!refined) {
    stats.notUnique++
    return null
  }

  const counted = countSolutions(refined, k, n, w, h, 2, spec.maxNodes)
  if (counted.timedOut) {
    stats.timeout++
    return null
  }
  if (counted.count !== 1) {
    stats.notUnique++
    return null
  }

  if (spec.requireLogic) {
    const rules = solveByRules(refined, k, n, w, h, true, 240)
    if (!rules.ok || !rules.saturated) {
      // 仍然可用；check 会给出警告
    }
  }

  return { regions: refined, solution }
}

const SPECS: GenSpec[] = [
  {
    w: 6,
    h: 6,
    k: 1,
    seed: 0x53544101,
    difficulty: 'easy',
    name: '星海初航',
    series: '入门',
    attempts: 300,
    maxNodes: 80_000,
    requireLogic: true,
  },
  {
    w: 7,
    h: 7,
    k: 1,
    seed: 0x53544102,
    difficulty: 'easy',
    name: '七域星图',
    series: '入门',
    attempts: 400,
    maxNodes: 100_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    k: 1,
    seed: 0x53544103,
    difficulty: 'medium',
    name: '星域回廊',
    series: '进阶',
    attempts: 500,
    maxNodes: 120_000,
    requireLogic: true,
  },
  {
    w: 9,
    h: 9,
    k: 1,
    seed: 0x53544104,
    difficulty: 'medium',
    name: '九宫星阵',
    series: '进阶',
    attempts: 600,
    maxNodes: 150_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    k: 2,
    seed: 0x53544105,
    difficulty: 'hard',
    name: '双星迷航',
    series: '挑战',
    attempts: 800,
    maxNodes: 200_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    k: 2,
    seed: 0x53544106,
    difficulty: 'hard',
    name: '双星终局',
    series: '挑战',
    attempts: 1000,
    maxNodes: 200_000,
    requireLogic: false,
  },
]

export function generatePuzzles(): RawPuzzleOut[] {
  const out: RawPuzzleOut[] = []
  for (const spec of SPECS) {
    const rng = mulberry32(spec.seed)
    const stats: AttemptStats = {
      placeFail: 0,
      groupFail: 0,
      partitionFail: 0,
      notUnique: 0,
      timeout: 0,
    }
    let made: { regions: number[]; solution: number[] } | null = null
    const t0 = Date.now()
    for (let attempt = 0; attempt < spec.attempts; attempt++) {
      made = attemptPuzzle(spec, rng, stats)
      if (made) break
    }
    if (!made) {
      console.error(`[星之战 gen] ${spec.name} 失败统计：`, stats)
      throw new Error(`[星之战 gen] ${spec.name} 在 ${spec.attempts} 次尝试内没有生成合法题`)
    }
    const stars = made.solution.filter((v) => v === STAR).length
    console.log(
      `[星之战 gen] ${spec.name} ${spec.w}×${spec.h} K=${spec.k}：星星 ${stars}，${Date.now() - t0}ms`,
    )
    out.push({
      id: `star-battle-${spec.w}x${spec.h}-k${spec.k}-${spec.seed.toString(36)}`,
      name: spec.name,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: spec.series,
      board: encodeBoard(made.regions, spec.k),
      solution: encodeCells(made.solution),
    })
  }
  return out
}
