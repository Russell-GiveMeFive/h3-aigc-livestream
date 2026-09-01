import type { WorkflowState } from '@h3/protocol/types'

/** 每间房间一份 WorkflowState（纯内存；与现有 Session/LiveStream 同生命周期） */
export class WorkflowStore {
  private map = new Map<string, WorkflowState>()

  /** 取出；不存在则返回 initial idle state */
  get(roomId: string): WorkflowState {
    const s = this.map.get(roomId)
    if (s) return s
    const init: WorkflowState = {
      roomId,
      phase: 'idle',
      collectedDanmaku: [],
      draftBeats: [],
      confirmedBeats: [],
      generatedClips: [],
      startedAt: Date.now(),
    }
    this.map.set(roomId, init)
    return init
  }

  /** 覆写（必须把 get() 出来的对象传回来，否则等于新建） */
  upsert(state: WorkflowState): void {
    this.map.set(state.roomId, state)
  }

  /** 清掉某个房间的工作流（stop/reset 时用） */
  reset(roomId: string): void {
    this.map.delete(roomId)
  }

  /** 调试/测试用：列全部房间 */
  keys(): string[] {
    return [...this.map.keys()]
  }
}

/** 单例：与现有 Hub/Session 风格保持一致 */
export const workflowStore = new WorkflowStore()
