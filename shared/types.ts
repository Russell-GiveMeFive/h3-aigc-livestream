// H3·LIVE 前后端共享协议：领域类型 + HTTP 契约 + WS 契约
// 修改此处即同步 server 与 web；非协议类型（Danmaku/LogLine/LogKind）放 web 端独有

// ── 领域：剧本 → 视频生成 ──

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

// ── 状态枚举 ──

export type ShotStatus = 'queued' | 'running' | 'ready' | 'failed'

export type StreamPhase = 'idle' | 'splitting' | 'running' | 'stopping' | 'stopped' | 'error'

/** M2 已声明三种续写模式；M1 只落地 'ai' */
export type ContinueMode = 'ai' | 'suggest' | 'crowd'

export type VideoResolution = '480P' | '768P'

// ── 视图（HTTP / WS 序列化用） ──

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
  resolution: VideoResolution
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

// ── HTTP 契约 ──

export interface SessionResp {
  sessionId: string
  mock: boolean
}

export interface StartResp {
  roomId: string
  hlsUrl: string
  rtmpUrl: string
  viewerUrl: string
}

// ── WS 契约：每条都带 `type` 判别字面量，便于消费方窄化 ──

export type WsEvent =
  | { type: 'log'; msg: string }
  | { type: 'clip'; id: string; shotId: string; duration: number; url: string }
  | { type: 'beat'; summary: string; shots: number }
  | { type: 'phase'; phase: StreamPhase; msg?: string }
  | { type: 'error'; msg: string }
  | { type: 'danmaku'; id: string; user: string; text: string; ts: number }
  | { type: 'workflow'; phase: WorkflowPhase; detail?: string }

/** 弹幕来源标识 */
export type DanmakuSource = 'douyin' | 'manual' | 'mock'

/** 单条弹幕（含分类信息） */
export interface DanmakuItem {
  id: string
  user: string
  text: string
  ts: number
  source: DanmakuSource
  /** 0..1，分类器给的相关性分数；undefined 表示未分类 */
  relevance?: number
  /** 分类器是否标记为剧情相关 */
  relevant?: boolean
}

/** 手动工作流的阶段机（替代原自动循环 Director） */
export type WorkflowPhase =
  | 'idle'
  | 'collecting_danmaku'
  | 'reviewing_danmaku'
  | 'generating_script'
  | 'reviewing_beats'
  | 'generating_clips'
  | 'completed'
  | 'error'

/** 用户编辑中的 beat（prompt 可改、未确认前不入生成队列） */
export interface DraftBeat {
  id: string
  summary: string
  shots: Shot[]
  confirmed: boolean
}

/** 工作流全局状态 */
export interface WorkflowState {
  roomId: string
  phase: WorkflowPhase
  /** 收集到的弹幕（用户可编辑/删除/手动加） */
  collectedDanmaku: DanmakuItem[]
  /** 用户编辑过的 beat（提交剧本后填入） */
  draftBeats: DraftBeat[]
  /** 用户确认后的 beat（喂给视频生成），仅当前一轮 */
  confirmedBeats: Beat[]
  /** 已生成的 clip 列表（每个 beat 对应若干 shot → 若干 clip） */
  generatedClips: ClipView[]
  /** 历史剧本：每一项是一轮已确认的 Beat 列表（顺序：最旧 → 最新）。
   *  每当用户点击"确认并开始生成"时，把上一轮的 confirmedBeats 追加到这里。
   *  仅作只读记录，不会再用于视频生成；UI 折叠显示在剧本面板顶部。 */
  scriptHistory: Beat[][]
  error?: string
  startedAt: number
}

/** 用户可调的全部配置（持久化到 server/data/config.json）。
 *  注意：mode 由服务端启动 env (MOCK=1 / H3_API_KEY) 决定，前端无法切换。
 *  SessionResp.mock 是 server 推断出的当前会话是否 mock 状态，单独字段保留。 */
export interface AppConfig {
  apiKey: string
  video: {
    resolution: VideoResolution
    duration: number
    model: string
    seed?: number
    characterLockPrompt?: string
    /** 参考图 mm_file:// id（可选） */
    referenceImageFileId?: string
  }
  script: {
    model: string
    maxBeats: number
    shotsPerBeat: number
    /** 是否注入弹幕为剧情输入 */
    injectDanmaku: boolean
    temperature?: number
    thinking?: boolean
  }
  danmaku: {
    /** 0..10，单次收集的弹幕条数 */
    targetCount: number
    /** 黑名单词（命中则丢弃） */
    blacklist: string[]
    /** 最短文本长度（默认 2） */
    minLength: number
    /** 同用户最小间隔 ms（默认 800） */
    minIntervalMs: number
    /** 抖音房间号（手动填入，dycast 接入用） */
    douyinRoomId?: string
  }
}

/** 历史单条视频（持久化到 server/data/history/<roomId>/） */
export interface HistoryClip {
  id: string
  roomId: string
  shotId: string
  beatSummary: string
  prompt: string
  duration: number
  url: string
  createdAt: number
}

/** 一个完整工作流的快照（一次提交即一条） */
export interface HistoryEntry {
  id: string
  roomId: string
  title: string
  createdAt: number
  danmakuUsed: DanmakuItem[]
  beats: DraftBeat[]
  clips: HistoryClip[]
}

/** 设置页 REST 契约 */
export interface ConfigResp {
  /** apiKey 在响应里会被脱敏成 '***' */
  config: Omit<AppConfig, 'apiKey'> & { apiKey: string }
  defaults: AppConfig
}

/** 把 storyState 拍成续写 prompt 用的紧凑摘要（纯函数，无副作用） */
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