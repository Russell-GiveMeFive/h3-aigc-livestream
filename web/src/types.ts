// 协议层类型来自 shared（前后端共用）
export type {
  Shot,
  Beat,
  Character,
  StoryState,
  Clip,
  ShotStatus,
  StreamPhase,
  ContinueMode,
  VideoResolution,
  ShotView,
  BeatView,
  ClipView,
  StreamStatus,
  WsEvent,
  SessionResp,
  StartResp,
  DanmakuSource,
  DanmakuItem,
  LiveDanmakuStatus,
  WorkflowPhase,
  DraftBeat,
  WorkflowState,
  AppConfig,
  HistoryClip,
  HistoryEntry,
  ConfigResp,
} from '@h3/protocol/types'

// 前端独有的视图类型（不会序列化到后端）
export interface Danmaku {
  id: string
  user: string
  text: string
  ts: number
}

export type LogKind = 'info' | 'ok' | 'warn' | 'err'

/** 日志阶段标签：用于前端分组展示（已分到粒度合适即可，不与 workflow phase 一对一）。 */
export type LogStage =
  | 'session'     // 会话创建 / 验证 API key
  | 'collect'     // 收集弹幕
  | 'submit'      // 提交弹幕（生成剧本）
  | 'add'         // 手动加单条
  | 'split'       // AI 剧本拆分
  | 'confirm'     // 确认分镜
  | 'gen'         // 视频生成（含 gen queue）
  | 'stream'      // 推流 / HLS
  | 'ws'          // WebSocket 连接状态
  | 'recover'     // error 状态恢复
  | 'config'      // 配置保存 / 切换
  | 'sys'         // 其它系统级（fallback）

export interface LogLine {
  ts: number
  msg: string
  kind: LogKind
  /** 阶段分类标签，可选；为空时由 classifyLog 或 UI 回退推断 */
  stage?: LogStage
  /** 关联的 danmaku id（addStage === 'add' 时填） */
  danmakuId?: string
  /** 关联的 clip id（stage === 'gen' 时填） */
  clipId?: string
  /** 时长 ms（视频生成等耗时操作结果时填） */
  durationMs?: number
}