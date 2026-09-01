import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStreamer } from '../stores/streamerStore'
import {
  addDanmaku,
  collectDanmaku,
  confirmBeats,
  createSession,
  fetchConfig,
  generateWorkflowClips,
  getWorkflow,
  recoverWorkflow,
  removeDanmaku,
  resetWorkflow,
  submitDanmaku,
  wsUrl,
} from '../api'
import type {
  Danmaku as DanmakuView,
  DraftBeat,
  VideoResolution,
  WorkflowState,
} from '../types'
import { Chip } from '../components/ui'
import '../styles/streamer.css'
import Workbench from './streamer/Workbench'
import ConfigTab from './streamer/ConfigTab'
import LogTab from './streamer/LogTab'
import { getEffectiveMode } from '../lib/mode'

type TabKey = 'workbench' | 'config' | 'log'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'workbench', label: '工作台', icon: '◇' },
  { key: 'config', label: '配置', icon: '◆' },
  { key: 'log', label: '日志', icon: '◇' },
]

function phaseLabel(p: WorkflowState['phase']): string {
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

export default function StreamerPage() {
  const { sessionId, mock, serverMock, logs, wsConnected, setSession, setServerMock, addLog, setWs } = useStreamer()
  const [search] = useSearchParams()

  // 工作流入参
  const [premise, setPremise] = useState('')
  const [resolution, setResolution] = useState<VideoResolution>('480P')
  const [roomId, setRoomId] = useState<string | null>(null)

  // 工作流状态
  const [wf, setWf] = useState<WorkflowState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // 用户编辑态
  const [manualDmText, setManualDmText] = useState('')
  const [selectedDmIds, setSelectedDmIds] = useState<Set<string>>(new Set())
  const [editedBeats, setEditedBeats] = useState<DraftBeat[]>([])

  // 预览
  const [activeUrl, setActiveUrl] = useState<string | null>(null)

  // 顶部 chip 用的配置快照（视频模型 / 当前直播平台）
  const [videoModel, setVideoModel] = useState<string>('—')
  const [platform, setPlatform] = useState<string>('Douyin')

  // Tab 切换（支持 ?tab=config 从 /settings 返回时定位）
  const [tab, setTab] = useState<TabKey>(() => {
    const t = search.get('tab')
    return t === 'config' || t === 'log' || t === 'workbench' ? t : 'workbench'
  })

  const wsRef = useRef<WebSocket | null>(null)
  const wsRetryRef = useRef(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const roomRef = useRef<string | null>(null)
  roomRef.current = roomId

  // WS：日志 + clip 触发
  const connectWs = useCallback(
    (room: string) => {
      wsRef.current?.close()
      const ws = new WebSocket(wsUrl(room))
      wsRef.current = ws
      ws.onopen = () => {
        wsRetryRef.current = 0
        setWs(true)
        addLog('🔌 WebSocket 已连接', 'ok', { stage: 'ws' })
      }
      ws.onclose = () => {
        setWs(false)
        if (roomRef.current !== room || wsRef.current !== ws) return
        if (wsRetryRef.current >= 8) {
          addLog(`❌ WebSocket 已重试 ${wsRetryRef.current} 次仍无法连接，停止重连`, 'err', { stage: 'ws' })
          return
        }
        wsRetryRef.current++
        const delay = Math.min(30000, 1000 * 2 ** wsRetryRef.current) + Math.random() * 500
        setTimeout(() => connectWs(room), delay)
      }
      ws.onerror = () => setWs(false)
      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return
        try {
          const d = JSON.parse(ev.data as string) as { type?: string; msg?: string; url?: string; stage?: string }
          if (d.type === 'log' && d.msg) {
            addLog(d.msg)
          } else if (d.type === 'clip' && d.url) {
            addLog(`🎞 新片段就绪`, 'ok', { stage: 'gen' })
            setActiveUrl(d.url)
          } else if (d.type === 'error' && d.msg) {
            addLog(`❌ ${d.msg}`, 'err')
          }
        } catch {
          /* ignore */
        }
      }
    },
    [addLog, setWs],
  )

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPoll = useCallback(() => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      const room = roomRef.current
      if (!room) return
      try {
        const next = await getWorkflow(room)
        setWf(next)
        // 服务端 clip.url 已经是 '/clips/<file>'，直接用；不再二次重写
        const lastClip = next.generatedClips[next.generatedClips.length - 1]
        if (lastClip?.url) {
          setActiveUrl((prev) => prev ?? lastClip.url)
        }
      } catch {
        /* 房间不存在 */
      }
    }, 2000)
  }, [stopPoll])

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { mock?: boolean }) => {
        setServerMock(!!h.mock)
        if (h.mock) addLog('MOCK 模式：免 Key 演示', 'warn')
      })
      .catch(() => {})
    // 顶部 chip：拉一次 config 拿视频模型
    fetchConfig()
      .then((resp) => {
        if (resp?.config?.video?.model) setVideoModel(resp.config.video.model)
      })
      .catch(() => {})
    return () => {
      stopPoll()
      wsRef.current?.close()
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 给一个稳定 roomId（必须在事件处理里同步可用）
  function ensureRoomId(): string {
    if (roomRef.current) return roomRef.current
    const id = Math.random().toString(36).slice(2, 8)
    roomRef.current = id
    setRoomId(id)
    return id
  }

  const startWizard = () => {
    const id = ensureRoomId()
    addLog(`🧭 工作流开启：房间 ${id}`, 'ok')
    connectWs(id)
    startPoll()
    void getWorkflow(id)
      .then((s) => setWf(s))
      .catch(() => {
        setWf({
          roomId: id,
          phase: 'idle',
          collectedDanmaku: [],
          draftBeats: [],
          confirmedBeats: [],
          generatedClips: [],
          scriptHistory: [],
          startedAt: Date.now(),
        })
      })
  }

  const handleCollect = async () => {
    const room = ensureRoomId()
    if (!premise.trim()) {
      addLog('请先填写剧本前提', 'warn')
      return
    }
    if (!sessionId) {
      addLog('请先接入 API Key', 'warn')
      return
    }
    setBusy('collect')
    addLog('📥 正在收集弹幕…', 'ok', { stage: 'collect' })
    try {
      const resp = await collectDanmaku(sessionId!, room, 5, premise.trim())
      const next = { ...resp.state, collectedDanmaku: [...(wf?.collectedDanmaku ?? []), ...resp.danmaku] }
      setWf(next)
      const sel = new Set<string>()
      for (const d of resp.danmaku) {
        if (d.relevant !== false) sel.add(d.id)
      }
      // 每轮开始时清空旧选择：本轮提交只基于本轮最新弹幕，
      // 避免上一轮的勾选残留被 splitter 二次喂入。
      setSelectedDmIds(sel)
      addLog(`📥 收到 ${resp.danmaku.length} 条弹幕`, 'ok', { stage: 'collect' })
    } catch (e) {
      addLog(`💥 收集失败: ${(e as Error).message}`, 'err', { stage: 'collect' })
    } finally {
      setBusy(null)
    }
  }

  const handleAddManualDm = async () => {
    const text = manualDmText.trim()
    if (!text) return
    const room = ensureRoomId()
    try {
      const resp = await addDanmaku(sessionId!, room, text, '我（主播）')
      setWf(resp.state)
      setSelectedDmIds((prev) => new Set(prev).add(resp.item.id))
      setManualDmText('')
      addLog(`✏️ 已添加弹幕`, 'ok', { stage: 'add', danmakuId: resp.item.id })
    } catch (e) {
      addLog(`💥 添加弹幕失败: ${(e as Error).message}`, 'err', { stage: 'add' })
    }
  }

  const handleDeleteDm = async (id: string) => {
    const room = ensureRoomId()
    try {
      const resp = await removeDanmaku(sessionId!, room, id)
      setWf(resp.state)
      setSelectedDmIds((prev) => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    } catch (e) {
      addLog(`💥 删除弹幕失败: ${(e as Error).message}`, 'err', { stage: 'add' })
    }
  }

  // 清空队列：服务端 removeDanmaku 逐条删除，本地清掉选择集
  const handleClearQueue = async () => {
    const room = ensureRoomId()
    const list = wf?.collectedDanmaku ?? []
    if (!list.length) return
    setBusy('clear')
    addLog(`🗑 清空队列（${list.length} 条）…`, 'warn', { stage: 'collect' })
    try {
      let state = wf
      for (const d of list) {
        const resp = await removeDanmaku(sessionId!, room, d.id)
        state = resp.state
      }
      if (state) setWf(state)
      setSelectedDmIds(new Set())
      addLog(`🗑 队列已清空`, 'ok', { stage: 'collect' })
    } catch (e) {
      addLog(`💥 清空失败: ${(e as Error).message}`, 'err', { stage: 'collect' })
    } finally {
      setBusy(null)
    }
  }

  // 右侧实时弹幕点击 → addDanmaku 加入队列；若 id 已在队列则忽略
  const handlePickLiveDm = (item: DanmakuView) => {
    const room = ensureRoomId()
    if (!sessionId) {
      addLog('请先接入 API Key', 'warn')
      return
    }
    const exists = (wf?.collectedDanmaku ?? []).some((d) => d.id === item.id)
    if (exists) {
      addLog(`已加入队列：${item.text.slice(0, 12)}…`, 'info')
      return
    }
    void addDanmaku(sessionId, room, item.text, item.user)
      .then((resp) => {
        setWf(resp.state)
        setSelectedDmIds((prev) => new Set(prev).add(resp.item.id))
        addLog(`📥 直播间弹幕入队：${item.text.slice(0, 12)}…`, 'ok', { stage: 'add', danmakuId: resp.item.id })
      })
      .catch((e) => {
        addLog(`💥 入队失败: ${(e as Error).message}`, 'err', { stage: 'add' })
      })
  }

  const toggleDmSelected = (id: string) => {
    setSelectedDmIds((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const handleSubmitDm = async () => {
    const room = ensureRoomId()
    if (!wf) return
    const ids = Array.from(selectedDmIds)
    if (!ids.length) {
      addLog('请至少选一条弹幕作为输入', 'warn')
      return
    }
    setBusy('submit')
    const t0 = performance.now()
    addLog('🧠 正在用 AI 拆分剧本…', 'ok', { stage: 'split' })
    try {
      const resp = await submitDanmaku(sessionId!, room, ids, premise.trim() || undefined)
      setWf({ ...resp.state, collectedDanmaku: wf.collectedDanmaku })
      setEditedBeats(resp.draftBeats)
      const ms = Math.round(performance.now() - t0)
      addLog(`🧠 生成 ${resp.draftBeats.length} 拍，可编辑后确认`, 'ok', { stage: 'split', durationMs: ms })
    } catch (e) {
      addLog(`💥 剧本生成失败: ${(e as Error).message}`, 'err', { stage: 'split' })
    } finally {
      setBusy(null)
    }
  }

  const updateBeatSummary = (idx: number, summary: string) => {
    setEditedBeats((prev) => prev.map((b, i) => (i === idx ? { ...b, summary } : b)))
  }

  const updateShotPrompt = (bi: number, si: number, prompt: string) => {
    setEditedBeats((prev) =>
      prev.map((b, i) =>
        i !== bi
          ? b
          : {
              ...b,
              shots: b.shots.map((s, j) => (j === si ? { ...s, prompt } : s)),
            },
      ),
    )
  }

  const handleConfirmBeats = async () => {
    const room = ensureRoomId()
    if (!editedBeats.length) {
      addLog('没有可确认的 beats', 'warn')
      return
    }
    setBusy('confirm')
    addLog('📝 已保存编辑，正在准备生成…', 'ok', { stage: 'confirm' })
    try {
      const resp = await confirmBeats(sessionId!, room, editedBeats)
      setWf(resp.state)
      // 服务端已把本轮剧本归档进 scriptHistory 并清空 draftBeats，本地编辑态同步清空
      setEditedBeats([])
      addLog('📝 剧本已确认，准备生成视频', 'ok', { stage: 'confirm' })
      await handleGenerateClips()
    } catch (e) {
      addLog(`💥 确认失败: ${(e as Error).message}`, 'err', { stage: 'confirm' })
    } finally {
      setBusy(null)
    }
  }

  const handleGenerateClips = useCallback(async () => {
    const room = ensureRoomId()
    setBusy('generate')
    addLog('🎬 已入队，开始生成视频片段…', 'ok', { stage: 'gen' })
    try {
      const resp = await generateWorkflowClips(sessionId!, room)
      addLog(`🎬 已入队 ${resp.queued} 个镜头`, 'ok', { stage: 'gen' })
      const next = await getWorkflow(room)
      setWf(next)
    } catch (e) {
      addLog(`💥 生成失败: ${(e as Error).message}`, 'err', { stage: 'gen' })
    } finally {
      setBusy(null)
    }
  }, [addLog])

  const handleResetWorkflow = async () => {
    const room = ensureRoomId()
    try {
      await resetWorkflow(room)
      addLog('🧹 工作流已重置', 'warn', { stage: 'sys' })
      const next = await getWorkflow(room)
      setWf(next)
      setEditedBeats([])
      setSelectedDmIds(new Set())
      setActiveUrl(null)
    } catch (e) {
      addLog(`💥 重置失败: ${(e as Error).message}`, 'err', { stage: 'sys' })
    }
  }

  const handleRecoverWorkflow = async () => {
    const room = ensureRoomId()
    try {
      const resp = await recoverWorkflow(room)
      setWf(resp.state)
      addLog('♻️ 已恢复，可继续编辑或重提', 'ok', { stage: 'recover' })
    } catch (e) {
      addLog(`💥 恢复失败: ${(e as Error).message}`, 'err', { stage: 'recover' })
    }
  }

  const phase = wf?.phase ?? 'idle'

  return (
    <div className="app streamer">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◤</span>
          <span className="brand-name">H3·LIVE</span>
          <span className="brand-sub">导演台 / WORKFLOW CONSOLE</span>
        </div>
        <div className="top-right">
          <Chip tone="warn" dot>模型 {videoModel}</Chip>
          {(() => {
            const mode = getEffectiveMode(serverMock, sessionId, mock)
            return (
              <Chip tone={mode === 'test' ? 'warn' : 'on'} dot>
                {mode === 'test' ? '测试' : '真实'}
              </Chip>
            )
          })()}
          <Chip tone="warn" dot>分辨率 {resolution}</Chip>
          <Chip tone={phase === 'error' ? 'rec' : phase === 'completed' ? 'on' : 'warn'} dot>
            工作流 · {phaseLabel(phase)}
          </Chip>
          <Chip tone="on" dot>{platform}</Chip>
          {roomId && <Chip tone="warn" dot>房间 {roomId}</Chip>}
          <Chip tone={wsConnected ? 'on' : 'rec'} dot>WS {wsConnected ? '已连接' : '断开'}</Chip>
          {!sessionId && (
            <button
              className="chip-link"
              style={{ cursor: 'pointer' }}
              onClick={() => setTab('config')}
            >
              ⚠ 未接入 Key → 配置
            </button>
          )}
        </div>
      </header>

      <nav className="tab-nav" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab-btn${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="layout streamer-layout" data-tab={tab}>
        {/* 用 hidden 切显隐：组件一直挂载，state 不丢，不会重复 mount 重副作用。
            切走时 display:none，省渲染但保留 onChange 等局部状态。 */}
        <div className="layout-pane" hidden={tab !== 'workbench'} aria-hidden={tab !== 'workbench'}>
          <Workbench
            wf={wf}
            busy={busy}
            sessionId={sessionId}
            premise={premise}
            resolution={resolution}
            manualDmText={manualDmText}
            selectedDmIds={selectedDmIds}
            editedBeats={editedBeats}
            activeUrl={activeUrl}
            roomId={roomId}
            setPremise={setPremise}
            setResolution={setResolution}
            setManualDmText={setManualDmText}
            setActiveUrl={setActiveUrl}
            onStartWizard={startWizard}
            onCollect={handleCollect}
            onSubmitDm={handleSubmitDm}
            onAddManual={handleAddManualDm}
            onClearQueue={handleClearQueue}
            onDeleteDm={handleDeleteDm}
            onToggleSelect={toggleDmSelected}
            onPickLiveDm={handlePickLiveDm}
            onUpdateBeatSummary={updateBeatSummary}
            onUpdateShotPrompt={updateShotPrompt}
            onConfirmBeats={handleConfirmBeats}
            onGenerateClips={handleGenerateClips}
            onResetWorkflow={handleResetWorkflow}
            onRecoverWorkflow={handleRecoverWorkflow}
          />
        </div>

        <div className="layout-pane config-pane" hidden={tab !== 'config'} aria-hidden={tab !== 'config'}>
          <ConfigTab />
        </div>

        <div className="layout-pane log-pane" hidden={tab !== 'log'} aria-hidden={tab !== 'log'}>
          <LogTab />
        </div>
      </div>

      {/* 底部状态条：始终渲染，从 logs 取最新一条；日志标签页不重复显示 */}
      {tab !== 'log' && (
        <div className="status-bar" aria-live="polite">
          <span className="status-bar-label">最新</span>
          <span className="status-bar-msg">
            {logs.length ? logs[logs.length - 1].msg : '等待流水事件…'}
          </span>
        </div>
      )}
    </div>
  )
}
