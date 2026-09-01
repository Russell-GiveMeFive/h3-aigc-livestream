/** 旧 types.ts 已迁移到 shared/types.ts（前后端共享）。
 *  本文件保留作为门面，老 import 'server/src/types' 仍可工作。 */
export type {
  Shot,
  Beat,
  Character,
  StoryState,
  Clip,
  StreamPhase,
  ContinueMode,
  ShotStatus,
  ShotView,
  BeatView,
  ClipView,
  StreamStatus,
  WsEvent,
  VideoResolution,
  SessionResp,
  StartResp,
} from '@h3/protocol/types'
export { storySummary } from '@h3/protocol/types'