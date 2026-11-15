/**
 * 星之战题库生成配置
 */

import { generatePuzzles as generate } from '../src/game/generator.ts'

export const NAME = '星之战生成器'

export function generatePuzzles() {
  return generate()
}
