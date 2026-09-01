import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getHistory, getHistoryClipUrl, listHistory } from '../api'
import type { DanmakuItem, DraftBeat, HistoryClip, HistoryEntry } from '@h3/protocol/types'
import { Chip, Panel, Stat } from '../components/ui'
import '../styles/history.css'

/** History viewer: list of past workflow runs + click to expand into detail. */
export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const { entries: list } = await listHistory()
      setEntries(list)
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
      setEntries([])
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  if (entries === null) {
    return (
      <main className="history-page">
        <header className="page-header">
          <h1 className="page-title">历史回看</h1>
          <Link className="back-link" to="/streamer">← 返回控制台</Link>
        </header>
        <Panel title="载入中">
          <p className="muted">正在拉取历史记录…</p>
        </Panel>
      </main>
    )
  }

  return (
    <main className="history-page">
      <header className="page-header">
        <h1 className="page-title">历史回看</h1>
        <div className="header-actions">
          <button className="ghost-btn" onClick={reload}>刷新</button>
          <Link className="back-link" to="/streamer">← 返回控制台</Link>
        </div>
      </header>

      {error && (
        <Panel title="错误" className="error-panel">
          <p>{error}</p>
        </Panel>
      )}

      {entries.length === 0 ? (
        <Panel title="暂无历史">
          <p className="muted">完成一次完整工作流后，生成的视频会出现在这里。</p>
        </Panel>
      ) : (
        <div className="history-list">
          {entries.map((e) => (
            <HistoryRow
              key={e.id}
              entry={e}
              isOpen={openId === e.id}
              onToggle={() => setOpenId(openId === e.id ? null : e.id)}
            />
          ))}
        </div>
      )}
    </main>
  )
}

function HistoryRow({
  entry,
  isOpen,
  onToggle,
}: {
  entry: HistoryEntry
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <article className={`history-row${isOpen ? ' open' : ''}`}>
      <button className="row-summary" onClick={onToggle} aria-expanded={isOpen}>
        <div className="row-title">
          <span className="caret">{isOpen ? '▾' : '▸'}</span>
          <span className="title-text">{entry.title || '(未命名剧本)'}</span>
        </div>
        <div className="row-meta">
          <Chip dot>房间 {entry.roomId}</Chip>
          <Chip tone="on">{entry.clips.length} 段</Chip>
          <Chip>{formatDate(entry.createdAt)}</Chip>
        </div>
      </button>
      {isOpen && <HistoryDetail id={entry.id} />}
    </article>
  )
}

function HistoryDetail({ id }: { id: string }) {
  const [entry, setEntry] = useState<HistoryEntry | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntry(null)
    setErr(null)
    getHistory(id)
      .then((e) => {
        if (!cancelled) setEntry(e)
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message ?? '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (err) {
    return (
      <div className="row-detail">
        <p className="err">载入失败：{err}</p>
      </div>
    )
  }
  if (!entry) {
    return (
      <div className="row-detail">
        <p className="muted">载入中…</p>
      </div>
    )
  }

  return (
    <div className="row-detail">
      <Panel title="入参弹幕（用户提交后喂给 AI 的）">
        <DanmakuList items={entry.danmakuUsed} />
      </Panel>

      <Panel title={`剧本分镜（${entry.beats.length} 个 beat）`}>
        <BeatsList beats={entry.beats} />
      </Panel>

      <Panel title={`生成视频（${entry.clips.length} 段）`}>
        <ClipGrid id={entry.id} clips={entry.clips} />
      </Panel>
    </div>
  )
}

function DanmakuList({ items }: { items: DanmakuItem[] }) {
  if (!items || items.length === 0) {
    return <p className="muted">无</p>
  }
  return (
    <ul className="danmaku-list">
      {items.map((d) => (
        <li key={d.id} className="danmaku-item">
          <span className="user">{d.user}</span>
          <span className="text">{d.text}</span>
        </li>
      ))}
    </ul>
  )
}

function BeatsList({ beats }: { beats: DraftBeat[] }) {
  if (!beats || beats.length === 0) {
    return <p className="muted">无 beat</p>
  }
  return (
    <ol className="beats-list">
      {beats.map((b, i) => (
        <li key={b.id} className="beat-item">
          <header className="beat-head">
            <span className="beat-idx">#{i + 1}</span>
            <span className="beat-summary">{b.summary}</span>
            <Chip tone={b.confirmed ? 'on' : 'warn'}>{b.confirmed ? '已确认' : '草稿'}</Chip>
          </header>
          {b.shots && b.shots.length > 0 && (
            <ul className="shot-list">
              {b.shots.map((s) => (
                <li key={s.id} className="shot-item">
                  <div className="shot-prompt">{s.prompt}</div>
                  <div className="shot-meta">
                    <Chip>{s.duration}s</Chip>
                    <span className="shot-id">{s.id}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

function ClipGrid({ id, clips }: { id: string; clips: HistoryClip[] }) {
  if (!clips || clips.length === 0) {
    return <p className="muted">未生成任何视频</p>
  }
  return (
    <div className="clip-grid">
      {clips.map((c) => (
        <div key={c.id} className="clip-cell">
          <video src={getHistoryClipUrl(id, c.id)} controls preload="metadata" />
          <div className="clip-meta">
            <Stat label="时长" value={c.duration} unit="s" tone="cyan" />
            <div className="clip-info">
              <Chip>shot {c.shotId}</Chip>
              <p className="clip-prompt" title={c.prompt}>{c.prompt}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatDate(ts: number): string {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
