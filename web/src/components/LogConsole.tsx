import { useEffect, useRef } from 'react'
import type { LogLine, LogStage } from '../types'
import { timeOf } from '../api'

/** 阶段 emoji 标签（verbose 开启时显示） */
const STAGE_EMOJI: Record<LogStage, string> = {
  session: '🔑',
  collect: '📥',
  submit: '🧠',
  add: '✏️',
  split: '✂️',
  confirm: '📝',
  gen: '🎬',
  stream: '📡',
  ws: '🔌',
  recover: '♻️',
  config: '⚙️',
  sys: '·',
}

export default function LogConsole({
  logs,
  onClear,
  verbose = false,
}: {
  logs: LogLine[]
  onClear?: () => void
  /** 开启后每条多显示毫秒时间戳 + 阶段 emoji 分类 + 关联 id/时长 */
  verbose?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [logs.length])

  return (
    <div className="log-panel">
      <div className="bar-head">
        <span className="section-title">流水日志</span>
        {onClear && (
          <button className="mini" onClick={onClear}>
            清空
          </button>
        )}
      </div>
      <div ref={boxRef} className="log-box">
        {logs.map((l, i) => (
          <div key={i} className={`log-line ${l.kind}${verbose ? ' verbose' : ''}`}>
            <span className="t">
              {verbose
                ? new Date(l.ts).toISOString().slice(11, 23) // HH:MM:SS.mmm
                : timeOf(l.ts)}
            </span>
            {verbose && l.stage && (
              <span className={`stage stage-${l.stage}`}>
                {STAGE_EMOJI[l.stage]} {l.stage}
              </span>
            )}
            <span className="msg">{l.msg}</span>
            {verbose && (l.danmakuId || l.clipId || l.durationMs != null) && (
              <span className="log-meta">
                {l.danmakuId && <code>{l.danmakuId}</code>}
                {l.clipId && <code>{l.clipId}</code>}
                {l.durationMs != null && <code>{l.durationMs}ms</code>}
              </span>
            )}
          </div>
        ))}
        {!logs.length && <div className="log-empty">等待流水事件…</div>}
      </div>
    </div>
  )
}
