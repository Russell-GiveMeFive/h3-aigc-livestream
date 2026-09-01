import type { Danmaku } from '../types'

export default function DanmakuFeed({
  items,
  onSend,
  onPick,
  compact = false,
  /** false 时不渲染内部 "实时弹幕 / N 条" 头部（外层 Panel 已提供标题） */
  showHeader = true,
}: {
  items: Danmaku[]
  onSend?: (text: string) => void
  /** 点击一条弹幕 → 把它的内容送入下方弹幕队列（addDanmaku） */
  onPick?: (item: Danmaku) => void
  compact?: boolean
  showHeader?: boolean
}) {
  return (
    <section className={`danmaku-panel${compact ? ' compact' : ''}`}>
      {showHeader && (
        <div className="bar-head">
          <span className="section-title">实时弹幕</span>
          <span className="hint dim">{items.length} 条</span>
        </div>
      )}
      <div className="danmaku-list" aria-live="polite">
        {items.slice(-80).map((item) => (
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
          </div>
        ))}
        {!items.length && <div className="log-empty">等待观众发言…</div>}
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