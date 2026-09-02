import type { Beat } from '@h3/protocol/types'
import { sleep } from '../../util'
import { AiStoryContinuer } from '../continuer'
import type { DirectorContext, DirectorStrategy } from '../../interfaces/story'

/**
 * AI 续写模式（默认 M1）：缓冲低 + 队列有余量 → 调 AiStoryContinuer 拿一拍 → 入队。
 * 由 LiveStream 绑定为 DirectorStrategy。
 */
export class AiDirectorStrategy implements DirectorStrategy {
  private readonly continuer = new AiStoryContinuer()

  async tick(ctx: DirectorContext): Promise<Beat | null> {
    const room = ctx.maxAheadShots - ctx.pendingShots - ctx.runningShots
    let generated: Beat | null = null
    if (ctx.bufferedSec < ctx.targetBufferSec && room > 0) {
      try {
        const beat = await this.continuer.continue({
          state: ctx.state,
          provider: ctx.provider,
          mode: 'ai',
          logger: ctx.hooks.onLog,
        })
        ctx.hooks.onLog(`📝 续写剧情拍 #${ctx.state.beats.length}: ${beat.summary}`)
        ctx.hooks.onBeat(beat)
        generated = beat
      } catch (e) {
        ctx.hooks.onLog(`⚠️ 续写失败: ${(e as Error).message}，5s 后重试`)
        await sleep(5000)
      }
    }
    await sleep(1000)
    return generated
  }
}