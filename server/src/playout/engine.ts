import { Clip } from '../types'

/** 播放缓冲池：生成侧 addClip 入队，推流侧 takeNext 按序消费 */
export class PlayoutEngine {
  private ready: Clip[] = []
  private played = 0
  private underflow = 0

  addClip(clip: Clip): void {
    this.ready.push(clip)
  }

  takeNext(): Clip | undefined {
    if (!this.ready.length) {
      this.underflow++
      return undefined
    }
    this.played++
    return this.ready.shift()!
  }

  get bufferedSec(): number {
    return this.ready.reduce((sum, c) => sum + c.duration, 0)
  }

  get readyCount(): number {
    return this.ready.length
  }

  get playedCount(): number {
    return this.played
  }

  get underflowCount(): number {
    return this.underflow
  }
}
