import { useEffect, useMemo, useRef, useState } from 'react'
import type { Danmaku as DanmakuView, DraftBeat, VideoResolution, WorkflowPhase, WorkflowState } from '../../types'
import { Chip, Panel } from '../../components/ui'
import ClipWall from '../../components/ClipWall'
import DanmakuFeed from '../../components/DanmakuFeed'

/** 工作台标签页：左控制栈 / 中预览+剧本 / 右实时弹幕。所有状态由父组件 (StreamerPage) 持有并下发。 */

interface WorkbenchProps {
  // 状态
  wf: WorkflowState | null
  busy: string | null
  sessionId: string | null
  premise: string
  resolution: VideoResolution
  manualDmText: string
  selectedDmIds: Set<string>
  editedBeats: DraftBeat[]
  activeUrl: string | null
  roomId: string | null
  // setter
  setPremise: (v: string) => void
  setResolution: (v: VideoResolution) => void
  setManualDmText: (v: string) => void
  setActiveUrl: (url: string | null) => void
  // workflow handlers
  onStartWizard: () => void
  onCollect: () => void
  onSubmitDm: () => void
  onAddManual: () => void
  onClearQueue: () => void
  onDeleteDm: (id: string) => void
  onToggleSelect: (id: string) => void
  onPickLiveDm: (item: DanmakuView) => void
  onUpdateBeatSummary: (idx: number, summary: string) => void
  onUpdateShotPrompt: (bi: number, si: number, prompt: string) => void
  onConfirmBeats: () => void
  onGenerateClips: () => void
  onResetWorkflow: () => void
  onRecoverWorkflow: () => void
}

const PHASE_ORDER: WorkflowPhase[] = [
  'idle',
  'collecting_danmaku',
  'reviewing_danmaku',
  'generating_script',
  'reviewing_beats',
  'generating_clips',
  'completed',
  'error',
]

/** 允许"获取弹幕"的阶段：idle/error 起步、completed 下一轮。其他阶段（reviewing/generating）禁，避免误清。 */
const COLLECT_ALLOWED: ReadonlySet<WorkflowPhase> = new Set(['idle', 'completed', 'error'])

function phaseLabel(p: WorkflowPhase): string {
  return {
    idle: '空闲',
    collecting_danmaku: '收集中',
    reviewing_danmaku: '审阅弹幕',
    generating_script: '生成剧本',
    reviewing_beats: '审阅拍',
    generating_clips: '生成中',
    completed: '已完成',
    error: '错误',
  }[p]
}

export default function Workbench({
  wf,
  busy,
  sessionId,
  premise,
  resolution,
  manualDmText,
  selectedDmIds,
  editedBeats,
  activeUrl,
  roomId,
  setPremise,
  setResolution,
  setManualDmText,
  setActiveUrl,
  onStartWizard,
  onCollect,
  onSubmitDm,
  onAddManual,
  onClearQueue,
  onDeleteDm,
  onToggleSelect,
  onPickLiveDm,
  onUpdateBeatSummary,
  onUpdateShotPrompt,
  onConfirmBeats,
  onGenerateClips,
  onResetWorkflow,
  onRecoverWorkflow,
}: WorkbenchProps) {
  const phase = wf?.phase ?? 'idle'
  const phaseNo = useMemo(() => PHASE_ORDER.indexOf(phase), [phase])
  const collectedDm = wf?.collectedDanmaku ?? []
  const clips = wf?.generatedClips ?? []
  const clipCount = clips.length
  const canCollect = COLLECT_ALLOWED.has(phase)
  const collectBlockReason = canCollect ? '' : '当前阶段不可重新收集弹幕（避免清空已生成片段）'
  // 工作流一旦离开 idle（已点击启动），启动按钮置灰，避免重复启动造成状态机歧义
  const isStarted = phase !== 'idle'
  // 历史剧本：上一轮（及更早）已确认的剧本，只读、折叠在面板顶部
  const scriptHistory = wf?.scriptHistory ?? []

  // 预览区高度：用户可拖动调整，持久化到 localStorage
  const PREVIEW_MIN = 220
  const PREVIEW_MAX_GAP = 240 // 屏幕高度 - 此值 = 预览最大高度
  const PREVIEW_DEFAULT = 380
  const PREVIEW_LS_KEY = 'wb:preview-height'
  const [previewHeight, setPreviewHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return PREVIEW_DEFAULT
    const saved = Number(window.localStorage.getItem(PREVIEW_LS_KEY) ?? 0)
    if (saved >= PREVIEW_MIN) return Math.min(saved, window.innerHeight - PREVIEW_MAX_GAP)
    return Math.min(PREVIEW_DEFAULT, Math.max(PREVIEW_MIN, window.innerHeight - PREVIEW_MAX_GAP))
  })
  const dragRef = useRef<{ y: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  function clampPreview(n: number): number {
    return Math.min(Math.max(PREVIEW_MIN, n), Math.max(PREVIEW_MIN, window.innerHeight - PREVIEW_MAX_GAP))
  }
  function onResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    dragRef.current = { y: e.clientY, h: previewHeight }
    setDragging(true)
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
  }
  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const next = clampPreview(dragRef.current.h + (e.clientY - dragRef.current.y))
    setPreviewHeight(next)
  }
  function onResizeEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    try { window.localStorage.setItem(PREVIEW_LS_KEY, String(previewHeight)) } catch { /* noop */ }
  }

  const dmFeed = useMemo<DanmakuView[]>(
    () =>
      collectedDm.map((d) => ({
        id: d.id,
        user: d.user,
        text: d.text,
        ts: d.ts,
      })),
    [collectedDm],
  )

  // 由弹幕生成的剧本：在 reviewing_beats 时可编辑，其余只读
  const beatsEditable = phase === 'reviewing_beats' || phase === 'generating_script'
  const showBeatsPanel =
    editedBeats.length > 0 ||
    scriptHistory.length > 0 ||
    phase === 'reviewing_beats' ||
    phase === 'generating_script'

  return (
    <div className="workbench">
      {/* ════════ 左：控制栈 ════════ */}
      <div className="workbench-left">
        {/* 1. 剧情前提 + 启动/重置 */}
        <Panel title="剧情前提">
          <textarea
            id="wb-premise"
            aria-label="剧情前提"
            rows={5}
            placeholder="例如：末日废土，阿光穿越荒原寻找水源，发现废弃地下实验室……"
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
          />
          <label className="field-label" htmlFor="wb-resolution" style={{ marginTop: 10 }}>
            视频分辨率
          </label>
          <select
            id="wb-resolution"
            aria-label="视频分辨率"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as VideoResolution)}
          >
            <option value="480P">480P · 省成本 / 更快</option>
            <option value="768P">768P · 更清晰 / 更高成本</option>
          </select>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              className="primary"
              disabled={!sessionId || isStarted}
              onClick={onStartWizard}
              title={isStarted ? '工作流进行中，点击右侧■重置后可重新启动' : undefined}
            >
              {isStarted ? '已启动' : '▶ 启动'}
            </button>
            <button className="danger" disabled={!roomId} onClick={onResetWorkflow}>
              ■ 重置
            </button>
          </div>
          {roomId && (
            <p className="hint dim" style={{ marginTop: 8 }}>
              房间 {roomId} · 当前阶段 {phaseLabel(phase)}
            </p>
          )}
        </Panel>

        {/* 2. 手动剧情（手动添加弹幕）+ 添加/重置 */}
        <Panel title="手动剧情（手动添加弹幕）">
          <input
            aria-label="手动添加弹幕"
            placeholder="手动加一条：例如『帮我把场景从卧室换到阳台』"
            value={manualDmText}
            onChange={(e) => setManualDmText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAddManual()}
          />
          <div className="actions" style={{ marginTop: 10 }}>
            <button onClick={onAddManual} disabled={!manualDmText.trim()}>
              + 添加
            </button>
            <button onClick={() => setManualDmText('')} disabled={!manualDmText}>
              ↺ 重置
            </button>
          </div>
          <p className="hint dim" style={{ marginTop: 8 }}>
            添加后立即进入下方弹幕队列，可参与下一轮剧本生成。
          </p>
        </Panel>

        {/* 3. 弹幕队列 + 获取弹幕/清空队列/提交生成（按钮分两行，提交独占长条） */}
        <Panel title="弹幕队列">
          <div className="dm-queue-head">
            <span className="dm-queue-count">
              共 {collectedDm.length} 条
              {selectedDmIds.size > 0 && (
                <span className="dm-queue-sel"> · 已选 {selectedDmIds.size}</span>
              )}
            </span>
          </div>
          <div className="dm-list">
            {!collectedDm.length ? (
              <div className="empty-hint">
                队列为空。点击下方"获取弹幕"拉取，或在"手动剧情"中添加。
              </div>
            ) : (
              collectedDm.map((d) => (
                <div key={d.id} className={`dm-row${selectedDmIds.has(d.id) ? ' sel' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label="选用"
                    checked={selectedDmIds.has(d.id)}
                    onChange={() => onToggleSelect(d.id)}
                  />
                  <span className="dm-user">{d.user}</span>
                  <span className="dm-text">{d.text}</span>
                  <span className={`dm-rel${d.relevant ? ' ok' : ' dim'}`}>
                    {d.relevance != null ? `相关 ${(d.relevance * 100).toFixed(0)}%` : '未分类'}
                  </span>
                  <button className="mini" onClick={() => onDeleteDm(d.id)} aria-label="删除">✕</button>
                </div>
              ))
            )}
          </div>
          <div className="dm-queue-actions">
            <div className="dm-queue-actions-row">
              <button
                disabled={busy !== null || !premise.trim() || !sessionId || !canCollect}
                onClick={onCollect}
                title={collectBlockReason}
              >
                {busy === 'collect' ? '收集中…' : '获取弹幕'}
              </button>
              <button
                disabled={!collectedDm.length || busy !== null}
                onClick={onClearQueue}
              >
                清空队列
              </button>
            </div>
            <button
              className="primary dm-queue-submit"
              disabled={!selectedDmIds.size || busy !== null}
              onClick={onSubmitDm}
            >
              {busy === 'submit' ? '生成剧本…' : `提交 ${selectedDmIds.size} 条生成剧本`}
            </button>
          </div>
        </Panel>

        {/* 4. 阶段进度（始终位于左下） */}
        <Panel title="阶段进度">
          <ol className="phase-step">
            {(['idle', 'reviewing_danmaku', 'reviewing_beats', 'generating_clips', 'completed'] as WorkflowPhase[]).map(
              (pp, idx) => (
                <li
                  key={pp}
                  className={
                    idx < phaseNo ? 'done' : idx === phaseNo ? 'active' : ''
                  }
                >
                  {phaseLabel(pp)}
                </li>
              ),
            )}
          </ol>
          <div className="stats-grid" style={{ marginTop: 14 }}>
            <div className="stat">
              <div className="label">弹幕</div>
              <div className="value">{collectedDm.length}</div>
            </div>
            <div className="stat">
              <div className="label">拍数</div>
              <div className="value cyan">{wf?.confirmedBeats.length ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">已生成</div>
              <div className="value dim">{clipCount}</div>
            </div>
            <div className="stat">
              <div className="label">阶段</div>
              <div className="value dim">
                <Chip tone={phase === 'error' ? 'rec' : phase === 'completed' ? 'on' : 'warn'} dot>
                  {phaseLabel(phase)}
                </Chip>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ════════ 中：视频预览 + 剧本 ════════ */}
      <div className="workbench-mid">
        {phase === 'error' && wf?.error && (
          <div className="error-banner" role="alert" aria-live="assertive">
            <span className="error-icon">⚠</span>
            <span>{wf.error}</span>
            <button
              className="primary"
              style={{ marginLeft: 'auto' }}
              onClick={onRecoverWorkflow}
              disabled={busy !== null}
            >
              ♻️ 恢复（保留所有数据）
            </button>
          </div>
        )}

        {/* 视频预览（中上） */}
        <Panel className="preview-panel" title={`📺 视频预览 · ${phaseLabel(phase)}`}>
          <div className="bar-head">
            <span className="hint dim">{resolution} · {clipCount} 个片段</span>
            <div className="actions" style={{ marginLeft: 'auto' }}>
              {phase === 'completed' && (
                <button
                  disabled={busy !== null || !sessionId}
                  onClick={onCollect}
                >
                  🆕 新一轮
                </button>
              )}
            </div>
          </div>
          <div className="preview-stack" style={{ marginTop: 8, height: previewHeight }}>
            {activeUrl ? (
              <video
                key={activeUrl}
                className="preview-player"
                src={activeUrl}
                controls
                autoPlay
                muted
              />
            ) : (
              <div className="preview-player preview-placeholder">
                尚未生成任何片段
              </div>
            )}
            <ClipWall clips={clips} activeUrl={activeUrl} onSelect={setActiveUrl} />
          </div>
          <div
            className={`resize-handle${dragging ? ' dragging' : ''}`}
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            role="separator"
            aria-orientation="horizontal"
            aria-label="拖动调整视频预览高度"
            title="拖动调整高度"
          >
            <span className="resize-grip" />
          </div>
        </Panel>

        {/* 由弹幕生成的剧本（中下） */}
        {showBeatsPanel && (
          <Panel title={`由弹幕生成的剧本 (${editedBeats.length})`}>
            {/* 历史剧本：上一轮及更早的已确认剧本，只读、折叠在顶部 */}
            {scriptHistory.length > 0 && (
              <details className="script-history">
                <summary className="script-history-summary">
                  📜 历史剧本（{scriptHistory.length} 轮 · 共{' '}
                  {scriptHistory.reduce((n, beats) => n + beats.length, 0)} 拍）
                </summary>
                <div className="script-history-body">
                  {scriptHistory.map((roundBeats, ri) => (
                    <section key={ri} className="script-history-round">
                      <header className="script-history-round-head">
                        第 {ri + 1} 轮 · {roundBeats.length} 拍
                      </header>
                      {roundBeats.map((b) => (
                        <article key={b.id} className="beat-card beat-card-frozen">
                          <header className="beat-head">
                            <span className="beat-no">
                              {String(ri + 1).padStart(2, '0')}
                            </span>
                            <span className="beat-summary">{b.summary}</span>
                            <span className="beat-meta">
                              {b.shots.length} 拍 ·{' '}
                              {b.shots.reduce((a, s) => a + s.duration, 0)}s
                            </span>
                          </header>
                          {b.shots.map((s) => (
                            <div className="beat-shot-row" key={s.id}>
                              <span className="shot-chip">
                                {s.id} · {s.duration}s
                              </span>
                              <p className="shot-prompt">{s.prompt}</p>
                            </div>
                          ))}
                        </article>
                      ))}
                    </section>
                  ))}
                </div>
              </details>
            )}
            {!editedBeats.length && (
              <div className="empty-hint">尚无剧本。先在左侧弹幕队列勾选条目，再点击"提交生成"。</div>
            )}
            {editedBeats.map((b, bi) => (
              <article key={b.id} className="beat-card">
                <header className="beat-head">
                  <span className="beat-no">{String(bi + 1).padStart(2, '0')}</span>
                  {beatsEditable ? (
                    <input
                      className="beat-summary-input"
                      aria-label="拍剧情一句话"
                      value={b.summary}
                      onChange={(e) => onUpdateBeatSummary(bi, e.target.value)}
                    />
                  ) : (
                    <span className="beat-summary">{b.summary}</span>
                  )}
                  <span className="beat-meta">
                    {b.shots.length} 拍 · {b.shots.reduce((a, s) => a + s.duration, 0)}s
                  </span>
                </header>
                {b.shots.map((s, si) => (
                  <div className="beat-shot-row" key={s.id}>
                    <span className="shot-chip">{s.id} · {s.duration}s</span>
                    {beatsEditable ? (
                      <textarea
                        aria-label={`分镜 ${s.id} prompt`}
                        rows={2}
                        value={s.prompt}
                        onChange={(e) => onUpdateShotPrompt(bi, si, e.target.value)}
                      />
                    ) : (
                      <p className="shot-prompt">{s.prompt}</p>
                    )}
                  </div>
                ))}
              </article>
            ))}
            {beatsEditable && editedBeats.length > 0 && (
              <div className="actions" style={{ marginTop: 12 }}>
                <button
                  className="primary"
                  disabled={busy !== null}
                  onClick={onConfirmBeats}
                >
                  {busy === 'confirm' || busy === 'generate' ? '处理中…' : '✓ 确认并开始生成'}
                </button>
              </div>
            )}
          </Panel>
        )}
      </div>

      {/* ════════ 右：实时弹幕（贯穿全高） ════════ */}
      <div className="workbench-right">
        <Panel title="实时弹幕">
          <p className="hint dim" style={{ margin: '0 0 8px' }}>
            点击条目可加入下方弹幕队列
          </p>
          <DanmakuFeed items={dmFeed} onPick={onPickLiveDm} compact showHeader={false} />
        </Panel>
      </div>
    </div>
  )
}