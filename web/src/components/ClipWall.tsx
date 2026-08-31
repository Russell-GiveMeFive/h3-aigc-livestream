import { useMemo } from 'react'
import type { ClipView } from '../types'

/**
 * 生成视频墙：横向胶片条 + 主预览播放器。
 * 每个片段以 video preload=metadata 显示首帧，点击切换预览。
 */
export default function ClipWall({ clips, activeUrl, onSelect }: { clips: ClipView[]; activeUrl: string | null; onSelect: (url: string) => void }) {
  const unique = useMemo(() => {
    const seen = new Set<string>()
    const out: ClipView[] = []
    for (const c of clips) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        out.push(c)
      }
    }
    return out
  }, [clips])

  return (
    <div className="clip-wall">
      <video className="preview-player" src={activeUrl ?? undefined} controls autoPlay muted />
      {unique.length > 0 && (
        <div className="filmstrip">
          {unique.map((c) => (
            <button
              key={c.id}
              aria-label={`预览镜头 ${c.shotId}，时长 ${c.duration} 秒`}
              aria-pressed={activeUrl === c.url}
              className={`film-cell${activeUrl === c.url ? ' active' : ''}`}
              onClick={() => onSelect(c.url)}
              title={`${c.shotId} · ${c.duration}s`}
            >
              <video src={c.url} preload="metadata" muted playsInline />
              <span className="film-label">{c.shotId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
