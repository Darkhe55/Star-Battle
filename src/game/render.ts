/**
 * 星之战 —— SVG 渲染与命中
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
import {
  asStarPuzzle,
  asStarState,
  EMPTY,
  MARK,
  STAR,
  type StarResult,
} from './types'

const REGION_FILLS = [
  'hsl(150 32% 93%)',
  'hsl(35 44% 93%)',
  'hsl(210 36% 93%)',
  'hsl(280 28% 94%)',
  'hsl(0 36% 94%)',
  'hsl(180 30% 92%)',
  'hsl(60 36% 93%)',
  'hsl(320 26% 94%)',
  'hsl(105 26% 93%)',
  'hsl(15 40% 93%)',
  'hsl(240 24% 94%)',
  'hsl(195 32% 92%)',
]

function regionFill(region: number): string {
  return REGION_FILLS[((region % REGION_FILLS.length) + REGION_FILLS.length) % REGION_FILLS.length]!
}

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const cell = 50
  const pad = Math.round(cell * 0.42)
  return {
    cell,
    pad,
    width: puzzle.width,
    height: puzzle.height,
    svgWidth: pad * 2 + puzzle.width * cell,
    svgHeight: pad * 2 + puzzle.height * cell,
    k: 1,
  }
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asStarPuzzle(puzzle)
  const s = asStarState(state)
  const r = result as StarResult
  const w = puzzle.width
  const h = puzzle.height
  const regions = p.regions ?? []
  const bad = new Set<number>(r.badCells ?? [])

  const gap = Math.max(1, m.cell * 0.03)
  const inner = m.cell - gap
  const radius = m.cell * 0.1

  const parts: string[] = []
  parts.push(
    `<rect class="sb-board-bg" x="${m.pad - 9}" y="${m.pad - 9}" width="${w * m.cell + 18}" height="${h * m.cell + 18}" rx="${(m.cell * 0.22).toFixed(2)}" />`,
  )

  for (let i = 0; i < w * h; i++) {
    const x = m.pad + (i % w) * m.cell + gap / 2
    const y = m.pad + Math.floor(i / w) * m.cell + gap / 2
    const v = s.cells[i] ?? EMPTY
    const region = regions[i] ?? -1

    let cls = 'sb-cell'
    if (v === STAR) cls += ' star'
    else if (v === MARK) cls += ' mark'
    else cls += ' empty'
    if (region < 0) cls += ' unassigned'
    if (bad.has(i)) cls += ' bad'

    const fill = region < 0 ? '#f0dcda' : regionFill(region)
    let content = `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${fill}" />`

    if (region < 0) {
      content += `<text class="sb-unassigned-mark" x="${(x + inner / 2).toFixed(2)}" y="${(y + inner / 2 + m.cell * 0.02).toFixed(2)}" style="font-size:${(m.cell * 0.4).toFixed(2)}px">?</text>`
    } else if (v === STAR) {
      content += `<text class="sb-star" x="${(x + inner / 2).toFixed(2)}" y="${(y + inner / 2 + m.cell * 0.02).toFixed(2)}" style="font-size:${(m.cell * 0.52).toFixed(2)}px">★</text>`
    } else if (v === MARK) {
      content += `<text class="sb-mark" x="${(x + inner / 2).toFixed(2)}" y="${(y + inner / 2 + m.cell * 0.02).toFixed(2)}" style="font-size:${(m.cell * 0.36).toFixed(2)}px">×</text>`
    }

    if (bad.has(i)) {
      content += `<rect class="sb-error" x="${(x + 1.2).toFixed(2)}" y="${(y + 1.2).toFixed(2)}" width="${(inner - 2.4).toFixed(2)}" height="${(inner - 2.4).toFixed(2)}" rx="${(radius * 0.8).toFixed(2)}" />`
    }

    parts.push(`<g data-index="${i}">${content}</g>`)
  }

  // 区域粗边界
  const lines: string[] = []
  const seen = new Set<string>()
  const addLine = (x1: number, y1: number, x2: number, y2: number): void => {
    const key = `${x1.toFixed(1)},${y1.toFixed(1)},${x2.toFixed(1)},${y2.toFixed(1)}`
    if (seen.has(key)) return
    seen.add(key)
    lines.push(
      `<line class="sb-region-line" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`,
    )
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const region = regions[i] ?? -1
      const x0 = m.pad + x * m.cell
      const y0 = m.pad + y * m.cell
      const left = x > 0 ? (regions[i - 1] ?? -1) : null
      const up = y > 0 ? (regions[i - w] ?? -1) : null
      const right = x + 1 < w ? (regions[i + 1] ?? -1) : null
      const down = y + 1 < h ? (regions[i + w] ?? -1) : null
      if (left === null || left !== region) addLine(x0, y0, x0, y0 + m.cell)
      if (up === null || up !== region) addLine(x0, y0, x0 + m.cell, y0)
      if (right === null || right !== region) addLine(x0 + m.cell, y0, x0 + m.cell, y0 + m.cell)
      if (down === null || down !== region) addLine(x0, y0 + m.cell, x0 + m.cell, y0 + m.cell)
    }
  }
  parts.push(`<g class="sb-region-lines">${lines.join('')}</g>`)

  for (let i = 0; i < w * h; i++) {
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${(m.pad + (i % w) * m.cell).toFixed(2)}" y="${(m.pad + Math.floor(i / w) * m.cell).toFixed(2)}" width="${m.cell.toFixed(2)}" height="${m.cell.toFixed(2)}" />`,
    )
  }

  return `<svg class="board-svg sb-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(
  m: BoardMetrics,
  puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const col = Math.floor((x - m.pad) / m.cell)
  const row = Math.floor((y - m.pad) / m.cell)
  if (col < 0 || row < 0 || col >= puzzle.width || row >= puzzle.height) return null
  return { index: row * puzzle.width + col }
}
