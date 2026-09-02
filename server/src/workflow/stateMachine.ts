import type { WorkflowPhase, WorkflowState } from '@h3/protocol/types'

/** 用户/系统在工作流上能发出的所有动作（纯类型，便于扩展）
 *  注意：'collect' 已废弃——弹幕流式推送后，主播通过抓取按钮单条入库，不再批量 collect。
 *  保留字面量仅为兼容旧 selftest/单测；UI 不再触发该 action。 */
export type WorkflowAction =
  | 'collect'
  | 'submit_danmaku'
  | 'confirm_beats'
  | 'generate_clips'
  | 'fail'
  | 'reset'
  | 'recover'

/** canTransition / nextPhase 需要的最小上下文 */
export interface TransitionContext {
  action: WorkflowAction
  /** 任意上下文（错误消息等） */
  detail?: string
}

/** 允许的阶段迁移图：从 → to[] */
const ALLOWED: Record<WorkflowPhase, ReadonlyArray<WorkflowPhase>> = {
  idle: ['reviewing_danmaku', 'error'],
  reviewing_danmaku: ['generating_script', 'idle', 'error'],
  generating_script: ['reviewing_beats', 'error'],
  reviewing_beats: ['generating_clips', 'idle', 'error'],
  generating_clips: ['completed', 'error'],
  completed: ['idle', 'reviewing_danmaku'],
  error: ['idle'],
}

/** canTransition：检查 from→to 是否在状态图内允许 */
export function canTransition(from: WorkflowPhase, to: WorkflowPhase): boolean {
  return ALLOWED[from]?.includes(to) ?? false
}

/** nextPhase：根据当前 phase + action 计算目标 phase */
export function nextPhase(current: WorkflowPhase, action: WorkflowAction): WorkflowPhase | null {
  switch (action) {
    case 'collect':
      // 已废弃：保留分支仅为兼容旧 selftest/单测；统一走 reviewing_danmaku
      if (current === 'idle' || current === 'completed' || current === 'error') return 'reviewing_danmaku'
      if (current === 'reviewing_danmaku') return current
      return null
    case 'submit_danmaku':
      if (current === 'reviewing_danmaku') return 'generating_script'
      return null
    case 'confirm_beats':
      // 自动经过 reviewing_beats → generating_clips
      if (current === 'reviewing_beats') return 'generating_clips'
      return null
    case 'generate_clips':
      if (current === 'generating_clips') return null // 已在进行中；完成由 queue 事件驱动
      return null
    case 'fail':
      return 'error'
    case 'reset':
      return 'idle'
    case 'recover':
      // 只用于 error 阶段；保留所有数据，回到 reviewing_danmaku 让用户修复后继续
      if (current === 'error') return 'reviewing_danmaku'
      return null
  }
}

/** applyAction：返回新 state（不可变）。不在图内则 throw。 */
export function applyAction(
  state: WorkflowState,
  action: WorkflowAction,
  detail?: string,
): WorkflowState {
  // reset 是无条件允许
  if (action === 'reset') {
    return { ...state, phase: 'idle', collectedDanmaku: [], draftBeats: [], confirmedBeats: [], generatedClips: [], scriptHistory: [], error: undefined }
  }
  if (action === 'fail') {
    return { ...state, phase: 'error', error: detail ?? state.error }
  }
  // recover 只从 error 阶段回到 reviewing_danmaku，**保留** collectedDanmaku/draftBeats/confirmedBeats/generatedClips
  // （与 reset 区别：reset 清空；recover 修复后继续）。不走 canTransition，因为是"逃生通道"。
  if (action === 'recover') {
    if (state.phase !== 'error') {
      throw new Error(`recover 只用于 error 阶段，当前 ${state.phase}`)
    }
    return { ...state, phase: 'reviewing_danmaku', error: undefined }
  }
  const target = nextPhase(state.phase, action)
  if (!target) {
    throw new Error(`非法动作 ${action}：当前阶段 ${state.phase}`)
  }
  if (!canTransition(state.phase, target)) {
    throw new Error(`非法迁移 ${state.phase} → ${target}（动作 ${action}）`)
  }
  return { ...state, phase: target, error: undefined }
}

/** 直接强制迁移到 target（handlers 内部用，用于"动作走完但还要多走一步"的场景） */
export function transitionTo(state: WorkflowState, target: WorkflowPhase, patch?: Partial<WorkflowState>): WorkflowState {
  if (!canTransition(state.phase, target)) {
    throw new Error(`非法迁移 ${state.phase} → ${target}`)
  }
  return { ...state, ...patch, phase: target, error: undefined }
}

/** 用于 UI 高亮当前阶段对应"操作"的辅助映射（按需扩展） */
export const PHASE_HINT: Record<WorkflowPhase, string> = {
  idle: '点击下方按钮启动直播流',
  reviewing_danmaku: '请在右侧抓取弹幕加入队列，或手动添加',
  generating_script: '正在调用文本模型拆分剧本…',
  reviewing_beats: '请编辑各拍，确认后生成视频',
  generating_clips: '正在生成视频片段…',
  completed: '全部完成，可点击胶片回看',
  error: '工作流出错，可重置',
}
