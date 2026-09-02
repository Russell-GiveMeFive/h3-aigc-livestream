import { useState } from 'react'
import LogConsole from '../../components/LogConsole'
import { useStreamer } from '../../stores/streamerStore'

/** 日志标签页：撑满 .stage 区的全屏流水 + verbose 开关 + 清空按钮 */
export default function LogTab() {
  const { logs, clearLogs } = useStreamer()
  const [verbose, setVerbose] = useState(false)

  return (
    <div className="log-tab">
      <div className="log-tab-bar">
        <label className="log-tab-toggle">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => setVerbose(e.target.checked)}
          />
          <span>显示更多详情（毫秒时间戳 + 阶段 emoji）</span>
        </label>
        <span className="hint dim">{logs.length} 条 · 容量 300</span>
      </div>
      <div className="log-tab-fill">
        <LogConsole
          logs={logs}
          onClear={() => clearLogs()}
          verbose={verbose}
        />
      </div>
    </div>
  )
}
