/** 角色：外貌描述用于跨镜头一致性（H3-Max 无参考图时靠文本锚定） */
export interface Character {
  name: string
  appearance: string
}

export interface Shot {
  id: string
  beatId: string
  /** 视频生成提示词（H3-Max 的 text 项），含镜头/外观/动作/环境/情绪 */
  prompt: string
  duration: number
}

export interface Beat {
  id: string
  summary: string
  shots: Shot[]
}

export interface StoryState {
  title: string
  premise: string
  world: string
  characters: Character[]
  entities: string[]
  beats: Beat[]
}

/** 一个已生成、可播放的视频片段（本地文件） */
export interface Clip {
  id: string
  shotId: string
  path: string
  duration: number
  readyAt: number
}

export type StreamPhase = 'idle' | 'splitting' | 'running' | 'stopping' | 'stopped' | 'error'

export type ContinueMode = 'ai' | 'suggest' | 'crowd'

export type ShotStatus = 'queued' | 'running' | 'ready' | 'failed'

/** 主播端剧本时间线：每幕及其镜头状态 */
export interface ShotView {
  id: string
  beatId: string
  prompt: string
  duration: number
  status: ShotStatus
}

export interface BeatView {
  id: string
  summary: string
  shots: ShotView[]
}

/** 已生成的视频片段（可预览） */
export interface ClipView {
  id: string
  shotId: string
  url: string
  duration: number
  readyAt: number
}

export interface StreamStatus {
  roomId: string
  phase: StreamPhase
  hlsUrl: string
  rtmpUrl: string
  mock: boolean
  mode: ContinueMode
  resolution: '480P' | '768P'
  bufferedSec: number
  readyClips: number
  pendingShots: number
  runningTasks: number
  avgGenLatencyMs: number | null
  clipsProduced: number
  clipsPlayed: number
  currentBeatSummary: string | null
  error?: string
  startedAt: number
  beats: BeatView[]
  clips: ClipView[]
}

export function storySummary(state: StoryState): string {
  const lastBeats = state.beats
    .slice(-3)
    .map((b) => `- ${b.summary}`)
    .join('\n')
  const parts = [
    `标题: ${state.title}`,
    `世界观: ${state.world}`,
    `角色: ${state.characters.map((c) => `${c.name}(${c.appearance})`).join('、') || '无'}`,
  ]
  if (lastBeats) parts.push(`最近剧情:\n${lastBeats}`)
  if (state.entities.length) parts.push(`剧情实体: ${state.entities.join('、')}`)
  return parts.join('\n')
}
