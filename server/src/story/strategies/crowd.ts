import type { DirectorContext, DirectorStrategy } from '../../interfaces/story'

/**
 * crowd 模式占位 stub：纯弹幕驱动剧情。P3 弹幕工作台完成后实现。
 */
export class CrowdDirectorStrategy implements DirectorStrategy {
  async tick(_ctx: DirectorContext): Promise<null> {
    return null
  }
}