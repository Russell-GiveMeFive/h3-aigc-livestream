import { useEffect, useState } from 'react'
import type { AppConfig, VideoResolution } from '@h3/protocol/types'
import { createSession, fetchConfig, saveConfig } from '../../api'
import { useStreamer } from '../../stores/streamerStore'
import { Chip, Panel } from '../../components/ui'

/** 配置标签页：高频流参数 + 抖音房间号。
 *  完整字段（黑名单 / temperature / thinking 等）走 /settings 页；这里只放直播中常改的项。 */
export default function ConfigTab() {
  const { addLog, setSession } = useStreamer()

  // 配置（持久化到 server/data/config.json）
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [defaults, setDefaults] = useState<AppConfig | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)

  // API key 验证
  const [keyInput, setKeyInput] = useState('')
  const [keyMsg, setKeyMsg] = useState('')
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    fetchConfig()
      .then((r) => {
        setCfg(r.config)
        setDefaults(r.defaults)
      })
      .catch((e) => setSaveErr((e as Error).message || '加载失败'))
  }, [])

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setCfg((c) => (c ? { ...c, [key]: value } : c))
  }
  function updateVideo<K extends keyof AppConfig['video']>(key: K, value: AppConfig['video'][K]) {
    setCfg((c) => (c ? { ...c, video: { ...c.video, [key]: value } } : c))
  }
  function updateDanmaku<K extends keyof AppConfig['danmaku']>(key: K, value: AppConfig['danmaku'][K]) {
    setCfg((c) => (c ? { ...c, danmaku: { ...c.danmaku, [key]: value } } : c))
  }

  async function handleVerify() {
    setKeyMsg('')
    setVerifying(true)
    try {
      const resp = await createSession(keyInput.trim())
      // 关键：把 session 写进 store，否则工作台拿不到 sessionId / mock。
      setSession(resp.sessionId, resp.mock)
      setKeyMsg(resp.mock ? '进入 MOCK 模式' : '✅ Key 已验证（工作台已切到真实 API）')
      addLog(
        resp.mock ? '已进入 MOCK 模式（服务端 MOCK=1）' : '✅ API Key 已验证，session 已激活',
        'ok',
        { stage: 'session' },
      )
    } catch (e) {
      setKeyMsg(`❌ ${(e as Error).message}`)
    } finally {
      setVerifying(false)
    }
  }

  async function handleSave() {
    if (!cfg) return
    setSaveErr('')
    setSaveMsg('')
    setSaving(true)
    try {
      // 关键：服务端 GET 永远返回 '***'（脱敏）。直接 POST 回去会把真 key 覆盖成 '***'。
      // 只有当用户在 keyInput 里填了新值、或服务端目前没 key 时才发送新 key。
      const newApiKey = keyInput.trim()
      const serverMasked = !cfg.apiKey || cfg.apiKey === '***' || cfg.apiKey.startsWith('***')
      const apiKeyToSend = newApiKey
        ? newApiKey
        : serverMasked
          ? '' // 之前没 key 或返回的是脱敏占位 → 这次也别覆盖
          : cfg.apiKey // 兜底（理论上不会到这里）
      const payload: AppConfig = {
        ...cfg,
        apiKey: apiKeyToSend,
        danmaku: {
          ...cfg.danmaku,
          douyinRoomId: cfg.danmaku.douyinRoomId?.trim() || undefined,
        },
      }
      const r = await saveConfig(payload)
      setCfg(r.config)

      // 关键：保存了新 key 后，旧 session 还拿着旧/空 key；要再起一次 session 让新 key 生效。
      if (newApiKey) {
        try {
          const sess = await createSession(newApiKey)
          setSession(sess.sessionId, sess.mock)
          setKeyMsg(`✅ 已保存，立即生效（${sess.mock ? 'MOCK' : '真实 API'} 已激活）`)
        } catch (e) {
          // 配置已落盘，只是 session 没刷新成，让用户手动再点一次验证
          setKeyMsg(`⚠ 已保存到磁盘，但刷新 session 失败：${(e as Error).message}`)
        }
      } else {
        setSaveMsg('✅ 已保存，立即生效')
      }
      setKeyInput('') // 用完即弃，UI 不留
      addLog('💾 配置已保存', 'ok', { stage: 'config' })
    } catch (e) {
      setSaveErr((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (defaults) {
      setCfg(defaults)
      setSaveMsg('已恢复默认值（未保存）')
      setSaveErr('')
    }
  }

  if (!cfg) {
    return (
      <div className="config-tab">
        <Panel title="加载中…">
          <p className="hint dim">正在读取 server/data/config.json …</p>
          {saveErr && <p className="hint err">❌ {saveErr}</p>}
        </Panel>
      </div>
    )
  }

  return (
    <div className="config-tab">
      <Panel title="🤖 模型配置">
        <div className="config-grid">
          <div>
            <label className="field-label" htmlFor="cfg-script-model">文本模型</label>
            <input
              id="cfg-script-model"
              type="text"
              placeholder="MiniMax-M3"
              value={cfg.script.model ?? ''}
              onChange={(e) =>
                setCfg((c) =>
                  c ? { ...c, script: { ...c.script, model: e.target.value } } : c,
                )
              }
            />
          </div>
          <div>
            <label className="field-label" htmlFor="cfg-video-model">视频模型</label>
            <input
              id="cfg-video-model"
              type="text"
              placeholder="MiniMax-H3-Max"
              value={cfg.video.model ?? ''}
              onChange={(e) => updateVideo('model', e.target.value)}
            />
          </div>
        </div>

        <label className="field-label" htmlFor="cfg-api-key" style={{ marginTop: 12 }}>API Key</label>
        <div className="key-row">
          <input
            id="cfg-api-key"
            type="password"
            placeholder="（GET 永远返回 ***；留空 = 不修改）"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          />
          <button onClick={handleVerify} disabled={verifying || !keyInput.trim()}>
            {verifying ? '验证中…' : '验证'}
          </button>
        </div>
        <p className={`hint${keyMsg.startsWith('❌') ? ' err' : ''}`}>{keyMsg || '仅 POST 时写入磁盘；内存即用即弃。'}</p>

        <div className="config-grid" style={{ marginTop: 12 }}>
          <div>
            <label className="field-label" htmlFor="cfg-resolution">视频分辨率</label>
            <select
              id="cfg-resolution"
              value={cfg.video.resolution}
              onChange={(e) => updateVideo('resolution', e.target.value as VideoResolution)}
            >
              <option value="480P">480P · 省成本 / 更快</option>
              <option value="768P">768P · 更清晰 / 更高成本</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="cfg-duration">单片段时长（秒，1..60）</label>
            <input
              id="cfg-duration"
              type="number"
              min={1}
              max={60}
              value={cfg.video.duration}
              onChange={(e) => updateVideo('duration', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="config-grid" style={{ marginTop: 12 }}>
          <div>
            <label className="field-label" htmlFor="cfg-max-beats">最大幕数（1..20）</label>
            <input
              id="cfg-max-beats"
              type="number"
              min={1}
              max={20}
              value={cfg.script.maxBeats}
              onChange={(e) =>
                setCfg((c) =>
                  c ? { ...c, script: { ...c.script, maxBeats: Number(e.target.value) } } : c,
                )
              }
            />
          </div>
          <div>
            <label className="field-label" htmlFor="cfg-shots-per-beat">每幕分镜数（1..10）</label>
            <input
              id="cfg-shots-per-beat"
              type="number"
              min={1}
              max={10}
              value={cfg.script.shotsPerBeat}
              onChange={(e) =>
                setCfg((c) =>
                  c ? { ...c, script: { ...c.script, shotsPerBeat: Number(e.target.value) } } : c,
                )
              }
            />
          </div>
        </div>
        <p className="hint dim" style={{ marginTop: 6 }}>
          <code>CLIP_DURATION / TARGET_BUFFER_SEC / MIN_BUFFER_SEC / POLL_INTERVAL_MS / GEN_CONCURRENCY</code> 走 .env，不在此处。如需改，重启 server。
        </p>
      </Panel>

      <Panel title="📡 抖音弹幕源" >
        <div className="config-grid">
          <div>
            <label className="field-label" htmlFor="cfg-room-id">房间号</label>
            <input
              id="cfg-room-id"
              type="text"
              placeholder="如：10776146386（留空则不接入）"
              value={cfg.danmaku.douyinRoomId ?? ''}
              onChange={(e) => updateDanmaku('douyinRoomId', e.target.value)}
            />
            <p className="hint dim">
              优先级：此处保存 &gt; process.env.DOUYIN_ROOM_ID；保存后无需重启。
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="cfg-target-count">单次收集条数（0..10）</label>
            <input
              id="cfg-target-count"
              type="number"
              min={0}
              max={10}
              value={cfg.danmaku.targetCount}
              onChange={(e) => updateDanmaku('targetCount', Number(e.target.value))}
            />
          </div>
        </div>

        <label className="field-label" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={!!cfg.script.injectDanmaku}
            onChange={(e) =>
              setCfg((c) =>
                c ? { ...c, script: { ...c.script, injectDanmaku: e.target.checked } } : c,
              )
            }
            style={{ marginRight: 6 }}
          />
          注入弹幕作为剧本输入
        </label>
      </Panel>

      <Panel title=" " className="config-actions">
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '💾 保存配置'}
          </button>
          <button onClick={handleReset}>↺ 重置默认</button>
          <a className="chip-link" href="/settings">完整设置 →</a>
          {saveMsg && <Chip tone="on">{saveMsg}</Chip>}
          {saveErr && <Chip tone="rec">❌ {saveErr}</Chip>}
        </div>
        <p className="hint dim" style={{ marginTop: 8 }}>
          完整字段（黑名单 / 最短长度 / temperature / thinking 等）前往
          <a href="/settings" style={{ marginLeft: 4 }}>/settings</a>。
        </p>
      </Panel>
    </div>
  )
}
