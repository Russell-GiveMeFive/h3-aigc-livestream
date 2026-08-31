import type { BeatView, ShotView } from '../types'
import { StatusDot } from './ui'

const STATUS_TEXT: Record<ShotView['status'], string> = {
  queued: '排队',
  running: '生成中',
  ready: '就绪',
  failed: '失败',
}

/**
 * 剧本时间线：每一幕(beat)一张卡片，镜头以状态点标注。
 * 点击"就绪"镜头可在预览播放器中回看。
 */
export default function BeatsTimeline({
  beats,
  onPlayShot,
}: {
  beats: BeatView[]
  onPlayShot: (shotId: string) => void
}) {
  if (!beats.length) {
    return <div className="empty-hint">开播后剧本将在这里逐幕展开…</div>
  }
  return (
    <div className="beats-list">
      {beats.map((beat, i) => {
        const ready = beat.shots.filter((s) => s.status === 'ready').length
        const done = beat.shots.length > 0 && ready === beat.shots.length
        return (
          <article key={beat.id} className={`beat-card${done ? ' done' : ''}`}>
            <header className="beat-head">
              <span className="beat-no">{String(i + 1).padStart(2, '0')}</span>
              <p className="beat-summary">{beat.summary}</p>
              <span className="beat-meta">
                {ready}/{beat.shots.length} 镜头
              </span>
            </header>
            {beat.shots.length > 0 && (
              <div className="shot-row">
                {beat.shots.map((shot) => (
                  <button
                    key={shot.id}
                    className={`shot-chip s-${shot.status}`}
                    disabled={shot.status !== 'ready'}
                    onClick={() => onPlayShot(shot.id)}
                    title={shot.prompt}
                  >
                    <StatusDot status={shot.status} />
                    <span className="shot-id">{shot.id}</span>
                    <span className="shot-dur">{shot.duration}s</span>
                    <span className="shot-state">{STATUS_TEXT[shot.status]}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
