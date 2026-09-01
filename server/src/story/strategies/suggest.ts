import type { DirectorContext, DirectorStrategy } from '../../interfaces/story'

/**
 * suggest 模式占位 stub：等弹幕剧情工作台（docs/二开规划.md 第二节）实现后，
 * 在 tick 里调用 StoryWorkbench.flush() 把候选弹幕塞入 continueStory 的 danmakuFeed。
 */
export class SuggestDirectorStrategy implements DirectorStrategy {
  async tick(_ctx: DirectorContext): Promise<null> {
    return null
  }
}