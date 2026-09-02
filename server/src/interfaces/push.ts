/** RTMP 推流器抽象：消费 PlayoutEngine 中的片段推到指定目标 */
export interface Pusher {
  readonly currentClipId: string | null
  readonly pushedCount: number
  start(): void
  stop(): Promise<void>
}