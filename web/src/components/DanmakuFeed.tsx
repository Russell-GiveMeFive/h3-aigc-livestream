import type { Danmaku } from '../types'

export default function DanmakuFeed({
  items,
  onSend,
  compact = false,
}: {
  items: Danmaku[]
  onSend?: (text: string) => void
  compact?: boolean
}) {
  return (
    <section className={`danmaku-panel${compact ? ' compact' : ''}`}>
      <div className="bar-head">
        <span className="section-title">实时弹幕</span>
        <span className="hint dim">{items.length} 条</span>
      </div>
      <div className="danmaku-list" aria-live="polite">
        {items.slice(-80).map((item) => (
          <div className="danmaku-line" key={item.id}>
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
