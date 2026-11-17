/**
 * 星之战 —— 规则引擎
 *
 * 规则（全部为可证明的安全定式，只做强制落子 / 排除，不假设唯一解）：
 *   adj    星星八邻接的格子不能放星（含横竖与对角）
 *   block  任意 2×2 至多 1 颗星（与八邻接等价，作为独立局部检查）
 *   count  每行 / 每列 / 每个区域恰好 K 颗星：满则其余标叉，候选数刚好够则全放星
 *   unit   单元候选排列：枚举行 / 列 / 区域内所有合法摆法（两两不八邻接），
 *          所有摆法都含的格强制放星，都不含的格排除
 *   band   双行 / 双列带精确枚举：枚举相邻两行（或两列）内所有满足配额、
 *          两两不八邻接、且不超区域剩余配额的摆法，取交集强制 / 排除；
 *          只用于 ≤ 12×12 的盘面（大棋盘组合数过大，跳过以保性能）
 *   hall   区域与行 / 列之间的配额交叉（Hall 约束）：一组区域的可选格若全部落在
 *          同样需求的行（或列）集合里，则这些行 / 列的星只能来自这些区域，
 *          其余区域在这些行 / 列上的候选格一律排除；需求超出则矛盾
 *
 * 这些规则只排除「一定不成立」的候选；推不动时由 solver.ts / logic.ts 的
 * 反证与回溯兜底，因此规则增补不会改变题目解集。
 */

import { EMPTY, MARK, STAR } from './types.ts'

export type RuleKind = 'adj' | 'block' | 'count' | 'unit' | 'band' | 'hall'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

const DX8 = [1, -1, 0, 0, 1, 1, -1, -1]
const DY8 = [0, 0, 1, -1, 1, -1, 1, -1]

/** 单元候选排列的枚举上限，超过就放弃该单元（只影响强度，不影响正确性） */
const MAX_UNIT_COMBOS = 20_000

/** 双行 / 双列带枚举的组合上限与适用盘面上限 */
const MAX_BAND_COMBOS = 6_000
const MAX_BAND_SIZE = 144

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

  const adjacent = (a: number, b: number): boolean => {
    const dx = (a % w) - (b % w)
    const dy = ((a / w) | 0) - ((b / w) | 0)
    if (dx > 1 || dx < -1 || dy > 1 || dy < -1) return false
    return dx !== 0 || dy !== 0
  }

  /** 单元候选排列：枚举所有「恰好 demand 颗星、两两不八邻接」的摆法 */
  const unitPlacement = (unit: Unit): boolean => {
    let starCount = 0
    const cands: number[] = []
    for (const i of unit.cells) {
      if (cells[i] === STAR) starCount++
      else if (cells[i] === EMPTY) cands.push(i)
    }
    const demand = stars - starCount
    if (demand < 0) return false
    if (demand === 0) {
      for (const i of cands) if (!set(i, MARK, 'count')) return false
      return true
    }
    if (cands.length < demand) return false

    const hits = new Int32Array(cands.length)
    const chosen: number[] = []
    let total = 0
    let over = false
    const rec = (start: number, left: number): void => {
      if (over) return
      if (left === 0) {
        total++
        for (const k of chosen) hits[k]!++
        if (total > MAX_UNIT_COMBOS) over = true
        return
      }
      for (let k = start; k < cands.length; k++) {
        if (cands.length - k < left) break
        const c = cands[k]!
        let ok = true
        for (const ch of chosen) {
          if (adjacent(cands[ch]!, c)) {
            ok = false
            break
          }
        }
        if (!ok) continue
        chosen.push(k)
        rec(k + 1, left - 1)
        chosen.pop()
        if (over) return
      }
    }
    rec(0, demand)
    if (over) return true
    if (total === 0) return false
    for (let k = 0; k < cands.length; k++) {
      if (hits[k] === 0) {
        if (!set(cands[k]!, MARK, 'unit')) return false
      } else if (hits[k] === total) {
        if (!set(cands[k]!, STAR, 'unit')) return false
      }
    }
    return true
  }

  /**
   * 双行 / 双列带精确枚举：相邻两行（或两列）内所有合法摆法取交集。
   * horizontal = true 表示「双行带」，false 表示「双列带」。
   */
  const bandPlacement = (horizontal: boolean, start: number): boolean => {
    if (size > MAX_BAND_SIZE) return true
    const len = horizontal ? w : h
    const lineA = start
    const lineB = start + 1
    const cellAt = (ln: number, t: number): number =>
      horizontal ? (ln === 0 ? lineA : lineB) * w + t : t * w + (ln === 0 ? lineA : lineB)
    const req: number[][] = [[], []]
    const cand: number[][] = [[], []]
    for (let ln = 0; ln < 2; ln++) {
      for (let t = 0; t < len; t++) {
        const i = cellAt(ln, t)
        const v = cells[i]
        if (v === STAR) req[ln]!.push(t)
        else if (v === EMPTY) cand[ln]!.push(t)
      }
    }
    const nonAdjacent = (set: number[]): boolean => {
      for (let a = 0; a < set.length; a++) {
        for (let b = a + 1; b < set.length; b++) {
          if (Math.abs(set[a]! - set[b]!) < 2) return false
        }
      }
      return true
    }
    for (let ln = 0; ln < 2; ln++) if (!nonAdjacent(req[ln]!)) return false
    for (const c0 of req[0]!) {
      for (const c1 of req[1]!) if (Math.abs(c0 - c1) < 2) return false
    }

    const demand: number[] = [0, 0]
    for (let ln = 0; ln < 2; ln++) {
      demand[ln] = stars - req[ln]!.length
      if (demand[ln]! < 0 || cand[ln]!.length < demand[ln]!) return false
    }

    // 每行的候选星列组合（已放星 + 新放星，行内两两不邻接）
    const sets: number[][][] = [[], []]
    for (let ln = 0; ln < 2; ln++) {
      const out = sets[ln]!
      const cur: number[] = []
      const recSet = (at: number, left: number): void => {
        if (left === 0) {
          const all = req[ln]!.concat(cur)
          if (nonAdjacent(all)) out.push(all)
          return
        }
        for (let k = at; k < cand[ln]!.length; k++) {
          if (cand[ln]!.length - k < left) break
          cur.push(cand[ln]![k]!)
          recSet(k + 1, left - 1)
          cur.pop()
        }
      }
      recSet(0, demand[ln]!)
      if (out.length === 0) return false
    }
    // 组合数上界（忽略跨行约束），过大则跳过该带
    if (sets[0]!.length * sets[1]!.length > MAX_BAND_COMBOS * 4) return true

    // 区域剩余配额（用于过滤摆法：一条带内新放的星不能超过区域剩余需求）
    const regDemand = new Int32Array(regionCount)
    for (let r = 0; r < regionCount; r++) regDemand[r] = stars
    for (let i = 0; i < size; i++) {
      if (cells[i] !== STAR) continue
      const r = regions[i] ?? -1
      if (r >= 0 && r < regionCount) regDemand[r]!--
    }

    const hits: Int32Array[] = [new Int32Array(len), new Int32Array(len)]
    const reqA = new Set(req[0]!)
    const reqB = new Set(req[1]!)
    let total = 0
    let over = false
    for (const a of sets[0]!) {
      for (const b of sets[1]!) {
        let ok = true
        for (const c0 of a) {
          for (const c1 of b) {
            if (Math.abs(c0 - c1) < 2) {
              ok = false
              break
            }
          }
          if (!ok) break
        }
        if (!ok) continue
        // 区域配额过滤（只统计新放的星）
        const local = new Map<number, number>()
        for (const c of a) {
          if (reqA.has(c)) continue
          const r = regions[cellAt(0, c)] ?? -1
          local.set(r, (local.get(r) ?? 0) + 1)
        }
        for (const c of b) {
          if (reqB.has(c)) continue
          const r = regions[cellAt(1, c)] ?? -1
          local.set(r, (local.get(r) ?? 0) + 1)
        }
        for (const [r, cnt] of local) {
          if (r >= 0 && cnt > regDemand[r]!) {
            ok = false
            break
          }
        }
        if (!ok) continue
        total++
        for (const c of a) hits[0]![c]!++
        for (const c of b) hits[1]![c]!++
        if (total > MAX_BAND_COMBOS) {
          over = true
          break
        }
      }
      if (over) break
    }
    if (over) return true
    if (total === 0) return false
    for (let ln = 0; ln < 2; ln++) {
      for (let t = 0; t < len; t++) {
        const i = cellAt(ln, t)
        if (cells[i] !== EMPTY) continue
        const hc = hits[ln]![t]!
        if (hc === 0) {
          if (!set(i, MARK, 'band')) return false
        } else if (hc === total) {
          if (!set(i, STAR, 'band')) return false
        }
      }
    }
    return true
  }

  /** 区域 / 行 / 列之间的配额交叉（Hall 约束） */
  const hallCheck = (): boolean => {
    if (w > 31 || h > 31) return true
    const rowDemand = new Int32Array(h)
    const colDemand = new Int32Array(w)
    const regDemand = new Int32Array(regionCount)
    const regRowMask = new Int32Array(regionCount)
    const regColMask = new Int32Array(regionCount)
    const regCandCount = new Int32Array(regionCount)
    const rowCandCount = new Int32Array(h)
    const colCandCount = new Int32Array(w)
    const rowCandRegions: number[][] = Array.from({ length: h }, () => [])
    const colCandRegions: number[][] = Array.from({ length: w }, () => [])
    const rowSeen: Uint8Array[] = Array.from({ length: h }, () => new Uint8Array(regionCount))
    const colSeen: Uint8Array[] = Array.from({ length: w }, () => new Uint8Array(regionCount))

    for (let y = 0; y < h; y++) rowDemand[y] = stars
    for (let x = 0; x < w; x++) colDemand[x] = stars
    for (let r = 0; r < regionCount; r++) regDemand[r] = stars

    for (let i = 0; i < size; i++) {
      const v = cells[i]
      const y = (i / w) | 0
      const x = i % w
      if (v === STAR) {
        rowDemand[y]!--
        colDemand[x]!--
        const r = regions[i] ?? -1
        if (r >= 0 && r < regionCount) regDemand[r]!--
      } else if (v === EMPTY) {
        rowCandCount[y]!++
        colCandCount[x]!++
        const r = regions[i] ?? -1
        if (r >= 0 && r < regionCount) {
          regCandCount[r]!++
          regRowMask[r]! |= 1 << y
          regColMask[r]! |= 1 << x
          if (!rowSeen[y]![r]) {
            rowSeen[y]![r] = 1
            rowCandRegions[y]!.push(r)
          }
          if (!colSeen[x]![r]) {
            colSeen[x]![r] = 1
            colCandRegions[x]!.push(r)
          }
        }
      }
    }
    for (let y = 0; y < h; y++) if (rowDemand[y]! < 0) return false
    for (let x = 0; x < w; x++) if (colDemand[x]! < 0) return false
    for (let r = 0; r < regionCount; r++) if (regDemand[r]! < 0) return false

    const maxSubset = regionCount <= 14 ? 3 : 2
    const inSet = new Uint8Array(regionCount)
    const inUnion = new Uint8Array(regionCount)

    const forEachSubset = (items: number[], run: (chosen: number[]) => boolean): boolean => {
      const chosen: number[] = []
      const rec = (start: number, left: number): boolean => {
        if (left === 0) return run(chosen)
        for (let k = start; k < items.length; k++) {
          if (items.length - k < left) break
          chosen.push(items[k]!)
          if (!rec(k + 1, left - 1)) return false
          chosen.pop()
        }
        return true
      }
      for (let size = 1; size <= maxSubset && size <= items.length; size++) {
        if (!rec(0, size)) return false
      }
      return true
    }

    // 区域子集 → 行 / 列
    const regionsWithDemand: number[] = []
    for (let r = 0; r < regionCount; r++) {
      if (regDemand[r]! > 0 && regCandCount[r]! > 0) regionsWithDemand.push(r)
    }
    const regionsToRows = (chosen: number[]): boolean => {
      let rowsU = 0
      let demandS = 0
      for (const r of chosen) {
        rowsU |= regRowMask[r]!
        demandS += regDemand[r]!
      }
      let demandT = 0
      for (let y = 0; y < h; y++) if (rowsU & (1 << y)) demandT += rowDemand[y]!
      if (demandS > demandT) return false
      if (demandS !== demandT) return true
      for (const r of chosen) inSet[r] = 1
      for (let y = 0; y < h; y++) {
        if (!(rowsU & (1 << y))) continue
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          if (cells[i] !== EMPTY) continue
          const r = regions[i] ?? -1
          if (r < 0 || inSet[r]) continue
          if (!set(i, MARK, 'hall')) {
            for (const rr of chosen) inSet[rr] = 0
            return false
          }
        }
      }
      for (const r of chosen) inSet[r] = 0
      return true
    }
    if (!forEachSubset(regionsWithDemand, regionsToRows)) return false

    const regionsToCols = (chosen: number[]): boolean => {
      let colsU = 0
      let demandS = 0
      for (const r of chosen) {
        colsU |= regColMask[r]!
        demandS += regDemand[r]!
      }
      let demandT = 0
      for (let x = 0; x < w; x++) if (colsU & (1 << x)) demandT += colDemand[x]!
      if (demandS > demandT) return false
      if (demandS !== demandT) return true
      for (const r of chosen) inSet[r] = 1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!(colsU & (1 << x))) continue
          const i = y * w + x
          if (cells[i] !== EMPTY) continue
          const r = regions[i] ?? -1
          if (r < 0 || inSet[r]) continue
          if (!set(i, MARK, 'hall')) {
            for (const rr of chosen) inSet[rr] = 0
            return false
          }
        }
      }
      for (const r of chosen) inSet[r] = 0
      return true
    }
    if (!forEachSubset(regionsWithDemand, regionsToCols)) return false

    // 行子集 → 区域
    const rowsWithDemand: number[] = []
    for (let y = 0; y < h; y++) if (rowDemand[y]! > 0 && rowCandCount[y]! > 0) rowsWithDemand.push(y)
    const rowsToRegions = (chosen: number[]): boolean => {
      let demandS = 0
      for (const y of chosen) demandS += rowDemand[y]!
      const union: number[] = []
      for (const y of chosen) {
        for (const r of rowCandRegions[y]!) {
          if (!inUnion[r]) {
            inUnion[r] = 1
            union.push(r)
          }
        }
      }
      let demandT = 0
      for (const r of union) demandT += regDemand[r]!
      if (demandS > demandT) {
        for (const r of union) inUnion[r] = 0
        return false
      }
      if (demandS === demandT) {
        let rowsMask = 0
        for (const y of chosen) rowsMask |= 1 << y
        for (const r of union) inSet[r] = 1
        for (let i = 0; i < size; i++) {
          if (cells[i] !== EMPTY) continue
          const r = regions[i] ?? -1
          if (r < 0 || !inSet[r]) continue
          if (rowsMask & (1 << ((i / w) | 0))) continue
          if (!set(i, MARK, 'hall')) {
            for (const rr of union) {
              inUnion[rr] = 0
              inSet[rr] = 0
            }
            return false
          }
        }
        for (const r of union) inSet[r] = 0
      }
      for (const r of union) inUnion[r] = 0
      return true
    }
    if (!forEachSubset(rowsWithDemand, rowsToRegions)) return false

    // 列子集 → 区域
    const colsWithDemand: number[] = []
    for (let x = 0; x < w; x++) if (colDemand[x]! > 0 && colCandCount[x]! > 0) colsWithDemand.push(x)
    const colsToRegions = (chosen: number[]): boolean => {
      let demandS = 0
      for (const x of chosen) demandS += colDemand[x]!
      const union: number[] = []
      for (const x of chosen) {
        for (const r of colCandRegions[x]!) {
          if (!inUnion[r]) {
            inUnion[r] = 1
            union.push(r)
          }
        }
      }
      let demandT = 0
      for (const r of union) demandT += regDemand[r]!
      if (demandS > demandT) {
        for (const r of union) inUnion[r] = 0
        return false
      }
      if (demandS === demandT) {
        let colsMask = 0
        for (const x of chosen) colsMask |= 1 << x
        for (const r of union) inSet[r] = 1
        for (let i = 0; i < size; i++) {
          if (cells[i] !== EMPTY) continue
          const r = regions[i] ?? -1
          if (r < 0 || !inSet[r]) continue
          if (colsMask & (1 << (i % w))) continue
          if (!set(i, MARK, 'hall')) {
            for (const rr of union) {
              inUnion[rr] = 0
              inSet[rr] = 0
            }
            return false
          }
        }
        for (const r of union) inSet[r] = 0
      }
      for (const r of union) inUnion[r] = 0
      return true
    }
    if (!forEachSubset(colsWithDemand, colsToRegions)) return false

    return true
  }

  while (changed) {
    changed = false

    // 1. 2×2 至多 1 颗星：块内已有星 → 其余格禁放；块内 2 星 → 矛盾
    for (let y = 0; y + 1 < h; y++) {
      for (let x = 0; x + 1 < w; x++) {
        const a = y * w + x
        const b = a + 1
        const c = a + w
        const d = c + 1
        const block = [a, b, c, d]
        let starCount = 0
        let starAt = -1
        for (const i of block) {
          if (cells[i] === STAR) {
            starCount++
            starAt = i
          }
        }
        if (starCount >= 2) return false
        if (starCount === 1) {
          for (const i of block) {
            if (i === starAt) continue
            if (cells[i] === EMPTY && !set(i, MARK, 'block')) return false
          }
        }
      }
    }

    // 2. 八邻接（兜底检查 + 标记）
    for (let i = 0; i < size; i++) {
      if (cells[i] !== STAR) continue
      for (const j of neighbors8(i, w, h)) {
        if (cells[j] === STAR) return false
        if (cells[j] === EMPTY && !set(j, MARK, 'adj')) return false
      }
    }

    // 3. 行 / 列 / 区域配额
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

    // 4. 单元候选排列：强制 / 排除
    for (const unit of units) {
      if (!unitPlacement(unit)) return false
    }

    // 5. 双行 / 双列带枚举
    if (size <= MAX_BAND_SIZE) {
      for (let y = 0; y + 1 < h; y++) {
        if (!bandPlacement(true, y)) return false
      }
      for (let x = 0; x + 1 < w; x++) {
        if (!bandPlacement(false, x)) return false
      }
    }

    // 6. 区域-行列 Hall 配额交叉
    if (!hallCheck()) return false
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
