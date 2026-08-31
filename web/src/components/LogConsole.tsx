import { useEffect, useRef } from 'react'
import type { LogLine } from '../types'
import { timeOf } from '../api'

export default function LogConsole({ logs, onClear }: { logs: LogLine[]; onClear?: () => void }) {
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
          <div key={i} className={`log-line ${l.kind}`}>
            <span className="t">{timeOf(l.ts)}</span>
            <span className="msg">{l.msg}</span>
          </div>
        ))}
        {!logs.length && <div className="log-empty">等待流水事件…</div>}
      </div>
    </div>
  )
}
