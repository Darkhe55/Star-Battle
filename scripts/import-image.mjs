/**
 * 星之战（Star Battle）题面图片导入（自动识图）
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--size N | --width W --height H]
 *                                  [--stars K] [--name 名称] [--id ID]
 *                                  [--append] [--verify] [--dry] [--map 0=1]
 *
 * 识图原理：
 *   1. Playwright + Edge 打开图片到 canvas，取像素；
 *   2. 黑像素投影定位全部网格线（每格一条细线）；
 *   3. 在每条相邻格边界的中点测量线宽：细线=普通网格，粗线=区域边界；
 *   4. 用一维 k-means 自动区分细/粗，按粗边界四连通洪泛得到区域编号；
 *   5. 生成题库格式：每格一个 base36 区域字符 + 末尾一个 K 字符；
 *   6. --append 写入 src/game/imported-puzzles.ts；
 *   7. --verify 用项目求解器检查唯一解（大图可能超时，只警告）。
 *
 * 识别不确定时可用：--stars 覆盖每行/列/区域的星星数；--thick N 手动指定粗细阈值；
 * --width/--height 覆盖棋盘尺寸。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { build as esbuild } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  return process.argv[i + 1] ?? fallback
}
function has(name) {
  return process.argv.includes(name)
}

const imageArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!imageArg) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--size N | --width W --height H] [--stars K] [--name 名称] [--id ID] [--append] [--verify] [--dry] [--thick N]',
  )
  process.exit(1)
}
const imagePath = path.resolve(process.cwd(), imageArg)
if (!existsSync(imagePath)) {
  console.error(`[import] 找不到图片：${imagePath}`)
  process.exit(1)
}

const sizeOpt = Number(arg('--size', '0')) || 0
const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const thickOpt = Number(arg('--thick', '0')) || 0
const starsOpt = Number(arg('--stars', '0')) || 0
const name = arg('--name', path.basename(imagePath, path.extname(imagePath)))
const id = arg('--id', `star-battle-import-${Date.now().toString(36)}`)
const series = arg('--series', '导入')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')

/* ───────────────────────── 识图（浏览器内） ───────────────────────── */

const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const analyzed = await page.evaluate(async ({ url, thickOpt }) => {
  const img = new Image()
  img.src = url
  await img.decode()
  const W = img.naturalWidth
  const H = img.naturalHeight
  const cv = document.getElementById('c')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, W, H).data
  const lum = (x, y) => {
    const i = (y * W + x) * 4
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
  }
  const dark = (x, y) => x >= 0 && y >= 0 && x < W && y < H && lum(x, y) < 110

  // 1) 投影找网格线
  const colC = new Int32Array(W)
  const rowC = new Int32Array(H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (dark(x, y)) {
        colC[x]++
        rowC[y]++
      }
  const maxC = Math.max(...colC)
  const maxR = Math.max(...rowC)
  const pickLines = (arr, max) => {
    const out = []
    const thr = max * 0.5
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] <= thr) continue
      let j = i
      while (j + 1 < arr.length && arr[j + 1] > thr) j++
      out.push((i + j) / 2)
      i = j
    }
    return out
  }
  const xs = pickLines(colC, maxC)
  const ys = pickLines(rowC, maxR)
  // 去掉误识别的小线（间距过近的合并）
  const dedupe = (arr) => {
    const out = []
    for (const v of arr) {
      if (!out.length || v - out[out.length - 1] > 4) out.push(v)
      else out[out.length - 1] = (out[out.length - 1] + v) / 2
    }
    return out
  }
  const xs2 = dedupe(xs)
  const ys2 = dedupe(ys)

  // 2) 测边宽：跨过边界线的暗像素连续长度
  const runAt = (x, y, horizontal) => {
    let best = 0
    if (horizontal) {
      for (let dy = -2; dy <= 2; dy++) {
        let run = 0
        for (let dx = -8; dx <= 8; dx++) {
          if (dark(Math.round(x + dx), Math.round(y + dy))) {
            run++
            if (run > best) best = run
          } else run = 0
        }
      }
    } else {
      for (let dx = -2; dx <= 2; dx++) {
        let run = 0
        for (let dy = -8; dy <= 8; dy++) {
          if (dark(Math.round(x + dx), Math.round(y + dy))) {
            run++
            if (run > best) best = run
          } else run = 0
        }
      }
    }
    return best
  }

  const nCols = xs2.length - 1
  const nRows = ys2.length - 1
  const cell = (xs2[nCols] - xs2[0]) / nCols
  const vEdge = Array.from({ length: nCols + 1 }, () => new Uint8Array(nRows))
  const hEdge = Array.from({ length: nRows + 1 }, () => new Uint8Array(nCols))
  const vThick = Array.from({ length: nCols + 1 }, () => new Float32Array(nRows))
  const hThick = Array.from({ length: nRows + 1 }, () => new Float32Array(nCols))
  const vVals = []
  const hVals = []
  for (let i = 1; i < nCols; i++) {
    for (let j = 0; j < nRows; j++) {
      const x = xs2[i]
      const y0 = ys2[j]
      const t = Math.max(
        runAt(x, y0 + cell * 0.3, true),
        runAt(x, y0 + cell * 0.5, true),
        runAt(x, y0 + cell * 0.7, true),
      )
      vThick[i][j] = t
      vVals.push(t)
    }
  }
  for (let j = 1; j < nRows; j++) {
    for (let i = 0; i < nCols; i++) {
      const y = ys2[j]
      const x0 = xs2[i]
      const t = Math.max(
        runAt(x0 + cell * 0.3, y, false),
        runAt(x0 + cell * 0.5, y, false),
        runAt(x0 + cell * 0.7, y, false),
      )
      hThick[j][i] = t
      hVals.push(t)
    }
  }
  // 3) 一维 k-means 分细/粗
  const all = [...vVals, ...hVals]
  const sorted = all.slice().sort((a, b) => a - b)
  let c1 = sorted[Math.floor(sorted.length * 0.15)] || 1
  let c2 = sorted[Math.floor(sorted.length * 0.85)] || 3
  for (let it = 0; it < 30; it++) {
    let s1 = 0
    let n1 = 0
    let s2 = 0
    let n2 = 0
    for (const v of all) {
      if (Math.abs(v - c1) <= Math.abs(v - c2)) {
        s1 += v
        n1++
      } else {
        s2 += v
        n2++
      }
    }
    if (n1) c1 = s1 / n1
    if (n2) c2 = s2 / n2
  }
  const thick = thickOpt > 0 ? thickOpt : (c1 + c2) / 2
  const ambiguous = Math.abs(c2 - c1) < 2

  for (let i = 1; i < nCols; i++)
    for (let j = 0; j < nRows; j++) vEdge[i][j] = vThick[i][j] >= thick ? 1 : 0
  for (let j = 1; j < nRows; j++)
    for (let i = 0; i < nCols; i++) hEdge[j][i] = hThick[j][i] >= thick ? 1 : 0

  return {
    W,
    H,
    xs: xs2,
    ys: ys2,
    nCols,
    nRows,
    cell,
    c1,
    c2,
    thick,
    ambiguous,
    vEdge: vEdge.map((row) => Array.from(row)),
    hEdge: hEdge.map((row) => Array.from(row)),
    vThick: vThick.map((row) => Array.from(row)),
  }
}, { url: dataUrl, thickOpt })

await browser.close()
const { W, H, xs, ys, nCols, nRows, cell, c1, c2, thick, ambiguous } = analyzed

if (nCols < 2 || nRows < 2) {
  console.error(`[import] 网格识别失败：${nCols}×${nRows}（竖线 ${xs.length} 条 / 横线 ${ys.length} 条）`)
  process.exit(1)
}
const w = widthOpt || sizeOpt || nCols
const h = heightOpt || sizeOpt || nRows
if (w !== nCols || h !== nRows) {
  console.error(
    `[import] 网格不匹配：识别到 ${nCols}×${nRows}，目标 ${w}×${h}。请去掉 --size/--width/--height 或改用与图片一致的尺寸`,
  )
  process.exit(1)
}
console.log(
  `[import] ${path.basename(imagePath)}：${W}×${H}，棋盘 ${w}×${h}，格距 ${cell.toFixed(2)}px，` +
    `细线≈${c1.toFixed(1)}px / 粗线≈${c2.toFixed(1)}px（阈值 ${thick.toFixed(1)}）`,
)
if (ambiguous) {
  console.warn('[import] 警告：细/粗线宽度差别很小，区域识别可能不准，可用 --thick N 手动指定阈值')
}

// 洪泛分区
const vEdge = analyzed.vEdge
const hEdge = analyzed.hEdge
const regionOf = new Array(w * h).fill(-1)
let regionCount = 0
for (let start = 0; start < w * h; start++) {
  if (regionOf[start] !== -1) continue
  const rid = regionCount++
  regionOf[start] = rid
  const stack = [start]
  while (stack.length) {
    const i = stack.pop()
    const x = i % w
    const y = (i / w) | 0
    const push = (j) => {
      if (j >= 0 && j < w * h && regionOf[j] === -1) {
        regionOf[j] = rid
        stack.push(j)
      }
    }
    if (x > 0 && !vEdge[x][y]) push(i - 1)
    if (x + 1 < w && !vEdge[x + 1][y]) push(i + 1)
    if (y > 0 && !hEdge[y][x]) push(i - w)
    if (y + 1 < h && !hEdge[y + 1][x]) push(i + w)
  }
}
const sizes = new Array(regionCount).fill(0)
for (const r of regionOf) sizes[r]++

const stars = starsOpt || 1
console.log(`[import] 区域 ${regionCount} 个，大小 ${Math.min(...sizes)}–${Math.max(...sizes)} 格，K=${stars}`)
if (regionCount < 2) {
  console.error('[import] 只识别出一个区域，说明区域粗边界没识别到；可用 --thick 手动指定阈值后重试')
  process.exit(1)
}
if (regionCount !== Math.max(w, h)) {
  console.warn(
    `[import] 注意：星之战要求区域数 = 行数（每行 K 颗星、每区域 K 颗星），当前区域 ${regionCount} ≠ ${Math.max(w, h)}，题面可能不合法`,
  )
}
if (sizes.some((s) => s < stars)) {
  console.warn('[import] 警告：有区域格数小于 K，题面不合法，区域边界可能有误')
}

// 预览
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
console.log('[import] 区域预览：')
for (let y = 0; y < h; y++) {
  console.log('  ' + regionOf.slice(y * w, y * w + w).map((r) => B36[r % 36]).join(' '))
}

/* ───────────────────────── 校验求解 ───────────────────────── */

if (verify) {
  const bundleFile = path.join(ROOT, 'node_modules', '.cache', 'import-verify-starbattle.mjs')
  await esbuild({
    absWorkingDir: ROOT,
    stdin: {
      contents: `export { countSolutions } from './src/game/solver.ts'\nexport { makeState } from './src/game/solver.ts'`,
      resolveDir: ROOT,
      sourcefile: 'import-verify-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundleFile,
    logLevel: 'silent',
  })
  const { countSolutions } = await import(pathToFileURL(bundleFile).href)
  const size = w * h
  const t0 = Date.now()
  const res = countSolutions(regionOf, stars, size, w, h, 2, 600_000)
  const ms = Date.now() - t0
  if (res.timedOut) {
    console.warn(`[import] 唯一性检查超时（${res.nodes} 节点 / ${ms}ms），无法确认唯一解`)
  } else if (res.count === 0) {
    console.error('[import] 无解：区域或 K 可能有误（可用 --thick / --stars 调整）')
    if (!dry) process.exit(1)
  } else if (res.count >= 2) {
    console.warn(`[import] 解不唯一：至少 ${res.count} 个（${res.nodes} 节点 / ${ms}ms）`)
  } else {
    console.log(`[import] 唯一解检查通过（${res.nodes} 节点 / ${ms}ms）`)
  }
}

if (dry) {
  console.log('[import] --dry：仅识别，不写入。')
  process.exit(0)
}

/* ───────────────────────── 写入题库 ───────────────────────── */

let boardStr = ''
for (const r of regionOf) boardStr += B36[r % 36]
boardStr += B36[Math.min(35, stars)]
if (!append) {
  console.log('[import] 预览模式（未写入）。board 编码：')
  console.log(JSON.stringify(boardStr))
  console.log('[import] 加 --append 可写入 src/game/imported-puzzles.ts')
  process.exit(0)
}

const file = path.join(ROOT, 'src/game/imported-puzzles.ts')
const difficulty = stars > 1 ? 'hard' : 'medium'
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${w}, height: ${h}, difficulty: '${difficulty}', series: ${JSON.stringify(series)}, board: ${JSON.stringify(boardStr)} },\n`
if (!existsSync(file)) {
  writeFileSync(
    file,
    `/* 由 scripts/import-image.mjs 追加，npm run gen 不会覆盖。 */\nimport type { RawPuzzle } from './puzzles-data.ts'\n\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]\n`,
  )
} else {
  let text = readFileSync(file, 'utf8')
  if (text.includes('IMPORTED_PUZZLES: RawPuzzle[] = []')) {
    text = text.replace('IMPORTED_PUZZLES: RawPuzzle[] = []', `IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]`)
  } else {
    const marker = text.lastIndexOf('\n]')
    if (marker < 0) throw new Error('imported-puzzles.ts 格式异常，找不到数组结尾')
    text = text.slice(0, marker + 1) + entry + text.slice(marker + 1)
  }
  writeFileSync(file, text)
}
console.log(`[import] 已写入 ${file}`)
