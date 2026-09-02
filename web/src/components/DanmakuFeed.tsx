import { useEffect, useRef, useState } from 'react'
import type { Danmaku } from '../types'

export default function DanmakuFeed({
  items,
  onSend,
  onPick,
  onCapture,
  capturedIds,
  liveStatus,
  compact = false,
  /** false 时不渲染内部 "实时弹幕 / N 条" 头部（外层 Panel 已提供标题） */
  showHeader = true,
}: {
  items: Danmaku[]
  onSend?: (text: string) => void
  /** @deprecated 旧版"点击整行入队"行为；流式改造后改用 onCapture 单条抓取按钮 */
  onPick?: (item: Danmaku) => void
  /** 流式改造：每条弹幕右边的"📥 抓取"按钮回调 */
  onCapture?: (item: Danmaku) => void
  /** 已经被抓取过的 id 集合（按钮显示 ✓ + disabled，避免重复抓） */
  capturedIds?: Set<string>
  /** 流连接状态：右栏顶部状态条 */
  liveStatus?: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'mock'
  compact?: boolean
  showHeader?: boolean
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  // 用户当前是否贴底（最后 20px 内视为贴底）；离开贴底后新消息不再自动滚
  const stuckRef = useRef(true)
  const [pendingCount, setPendingCount] = useState(0)

  // 状态条颜色
  const statusTone =
    liveStatus === 'live' || liveStatus === 'mock' ? 'ok' :
    liveStatus === 'connecting' || liveStatus === 'reconnecting' ? 'warn' :
    liveStatus === 'closed' ? 'err' :
    'idle'

  // 自动滚动：仅在用户贴底时滚动到末尾；否则累加 pendingCount
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (stuckRef.current) {
      // 切到下一帧再滚：DOM 刚追加完节点，scrollHeight 才是最新
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      })
      setPendingCount(0)
    } else {
      setPendingCount((n) => n + 1)
    }
  }, [items.length])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stuckRef.current = dist <= 20
    if (stuckRef.current) setPendingCount(0)
  }

  function jumpToBottom() {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stuckRef.current = true
    setPendingCount(0)
  }

  const lastItems = items.slice(-200)

  return (
    <section className={`danmaku-panel${compact ? ' compact' : ''}`}>
      {showHeader && (
        <div className="bar-head">
          <span className="section-title">实时弹幕</span>
          <span className={`dm-live-status dm-live-${statusTone}`}>
            <span className="dm-live-dot" />
            {liveStatus === 'live' && '已连接'}
            {liveStatus === 'mock' && 'MOCK 流'}
            {liveStatus === 'connecting' && '连接中…'}
            {liveStatus === 'reconnecting' && '重连中…'}
            {liveStatus === 'closed' && '已断开'}
            {(!liveStatus || liveStatus === 'idle') && '未启动'}
            {items.length > 0 && <span className="dm-live-count"> · {items.length} 条</span>}
          </span>
        </div>
      )}
      <div
        className="danmaku-list"
        aria-live="polite"
        ref={listRef}
        onScroll={onScroll}
      >
        {pendingCount > 0 && (
          <button className="dm-newmsg" type="button" onClick={jumpToBottom}>
            ▼ {pendingCount} 条新消息
          </button>
        )}
        {lastItems.map((item) => {
          const isCaptured = capturedIds?.has(item.id)
          return (
            <div
              className={`danmaku-line${onPick ? ' pickable' : ''}`}
              key={item.id}
              role={onPick ? 'button' : undefined}
              tabIndex={onPick ? 0 : undefined}
              onClick={onPick ? () => onPick(item) : undefined}
              onKeyDown={
                onPick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPick(item)
                      }
                    }
                  : undefined
              }
              title={onPick ? '点击加入弹幕队列' : undefined}
            >
              <span className="danmaku-user">{item.user}</span>
              <span className="danmaku-text">{item.text}</span>
              {onCapture && (
                <button
                  className={`dm-pick${isCaptured ? ' captured' : ''}`}
                  type="button"
                  aria-label={isCaptured ? '已抓取' : `抓取弹幕：${item.text}`}
                  disabled={isCaptured}
                  onClick={(e) => {
                    e.stopPropagation() // 不触发整行的 onPick
                    if (!isCaptured) onCapture(item)
                  }}
                >
                  {isCaptured ? '✓' : '📥 抓取'}
                </button>
              )}
            </div>
          )
        })}
        {!lastItems.length && <div className="log-empty">等待观众发言…</div>}
      </div>
      {onSend && (
        <form
          className="danmaku-form"
          onSubmit={(e) => {
            e.preventDefault()
            const input = e.currentTarget.elements.namedItem('danmaku') as HTMLInputElement
            const text = input.value.trim()
            if (!text) return
            onSend(text)
            input.value = ''
          }}
        >
          <input name="danmaku" aria-label="发送弹幕" maxLength={120} placeholder="说点什么…" />
          <button className="primary" type="submit">发送</button>
        </form>
      )}
    </section>
  )
}
