import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AppConfig, VideoResolution } from '@h3/protocol/types'
import { fetchConfig, saveConfig } from '../api'
import { Chip, Panel } from '../components/ui'

const TAB_NAV_STYLES = `
.settings-page .tab-nav {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-soft);
}
.settings-page .tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
  border-radius: 0;
  text-decoration: none;
}
.settings-page .tab-btn:hover:not(.active) { color: var(--text); background: transparent; }
.settings-page .tab-btn.active { color: var(--amber); border-bottom-color: var(--amber); }
`

const STYLES = `
.settings-page .settings-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 16px 20px;
  max-width: 1200px;
  margin: 0 auto;
}
.settings-page .panel { display: flex; flex-direction: column; gap: 8px; }
.settings-page .settings-actions { grid-column: 1 / -1; }
.settings-page .field-label {
  display: block;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  text-transform: uppercase;
  margin-top: 6px;
}
.settings-page input[type='text'],
.settings-page input[type='number'],
.settings-page input[type='password'],
.settings-page textarea,
.settings-page select {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}
.settings-page input:focus,
.settings-page textarea:focus,
.settings-page select:focus { border-color: var(--amber); }
.settings-page textarea { resize: vertical; min-height: 60px; font-family: var(--sans); }
.settings-page .key-row { display: flex; gap: 8px; }
.settings-page .key-row input { flex: 1; }
.settings-page .hint { font-size: 12px; color: var(--text-dim); }
.settings-page .hint.dim { color: var(--text-faint); }
.settings-page .hint.err { color: var(--red); }
.settings-page code {
  font-family: var(--mono);
  color: var(--cyan);
  background: var(--bg);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--line);
  font-size: 12px;
}
.settings-page button {
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--text);
  padding: 8px 14px;
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.15s ease;
}
.settings-page button:hover:not(:disabled) {
  border-color: var(--line-bright);
  background: var(--panel-2);
}
.settings-page button.primary {
  background: var(--amber);
  color: #000;
  border-color: var(--amber);
  font-weight: 600;
}
.settings-page button.primary:hover:not(:disabled) {
  background: var(--amber-deep);
  border-color: var(--amber-deep);
}
.settings-page button:disabled { opacity: 0.5; cursor: not-allowed; }
.settings-page .chip-link {
  color: var(--text-dim);
  text-decoration: none;
  font-family: var(--mono);
  font-size: 11px;
  border: 1px solid var(--line);
  padding: 2px 8px;
  border-radius: 3px;
}
.settings-page .chip-link:hover { color: var(--amber); border-color: var(--amber); }
@media (max-width: 900px) {
  .settings-page .settings-layout { grid-template-columns: 1fr; }
}
${TAB_NAV_STYLES}
`

type DraftConfig = AppConfig

function emptyDraft(): DraftConfig {
  return {
    apiKey: '',
    video: { resolution: '480P', duration: 5, model: '' },
    script: { model: '', maxBeats: 4, shotsPerBeat: 2, injectDanmaku: true },
    danmaku: { targetCount: 5, blacklist: [], minLength: 2, minIntervalMs: 800 },
  }
}

/** 把 ConfigResp.config（apiKey 已脱敏成 '***'）展开为可编辑草稿；apiKey 留空 */
function draftFromConfig(cfg: AppConfig): DraftConfig {
  return {
    apiKey: '', // 服务端永远返回 '***'，避免误覆盖；用户要改则手动填
    video: {
      resolution: cfg.video.resolution,
      duration: Number(cfg.video.duration) || 5,
      model: cfg.video.model ?? '',
      seed: cfg.video.seed,
      characterLockPrompt: cfg.video.characterLockPrompt ?? '',
      referenceImageFileId: cfg.video.referenceImageFileId ?? '',
    },
    script: {
      model: cfg.script.model ?? '',
      maxBeats: Number(cfg.script.maxBeats) || 4,
      shotsPerBeat: Number(cfg.script.shotsPerBeat) || 2,
      injectDanmaku: !!cfg.script.injectDanmaku,
      temperature: cfg.script.temperature,
      thinking: cfg.script.thinking,
    },
    danmaku: {
      targetCount: Number(cfg.danmaku.targetCount) || 0,
      blacklist: Array.isArray(cfg.danmaku.blacklist) ? [...cfg.danmaku.blacklist] : [],
      minLength: Number(cfg.danmaku.minLength) || 2,
      minIntervalMs: Number(cfg.danmaku.minIntervalMs) || 800,
      douyinRoomId: cfg.danmaku.douyinRoomId ?? '',
    },
  }
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<DraftConfig>(emptyDraft)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [blacklistText, setBlacklistText] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchConfig()
      .then((r) => {
        if (cancelled) return
        const d = draftFromConfig(r.config)
        setDraft(d)
        setBlacklistText(d.danmaku.blacklist.join('\n'))
        setLoaded(true)
      })
      .catch((e) => {
        if (cancelled) return
        setError((e as Error).message || '加载失败')
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function update<K extends keyof DraftConfig>(key: K, value: DraftConfig[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function updateVideo<K extends keyof DraftConfig['video']>(key: K, value: DraftConfig['video'][K]) {
    setDraft((d) => ({ ...d, video: { ...d.video, [key]: value } }))
  }
  function updateScript<K extends keyof DraftConfig['script']>(key: K, value: DraftConfig['script'][K]) {
    setDraft((d) => ({ ...d, script: { ...d.script, [key]: value } }))
  }
  function updateDanmaku<K extends keyof DraftConfig['danmaku']>(key: K, value: DraftConfig['danmaku'][K]) {
    setDraft((d) => ({ ...d, danmaku: { ...d.danmaku, [key]: value } }))
  }

  function handleBack() {
    // 取消未保存改动 + 返回简略配置（主播台"配置" tab）
    if (loaded) {
      fetchConfig()
        .then((r) => {
          const d = draftFromConfig(r.config)
          setDraft(d)
          setBlacklistText(d.danmaku.blacklist.join('\n'))
        })
        .catch(() => {})
    }
    navigate('/streamer?tab=config')
  }

  function handleSave() {
    setError('')
    setMsg('')
    // 客户端预校验（服务端还会再校验一遍）
    if (draft.video.resolution !== '480P' && draft.video.resolution !== '768P') {
      setError('分辨率必须是 480P 或 768P')
      return
    }
    if (draft.video.duration <= 0 || draft.video.duration > 60) {
      setError('视频时长必须在 1..60 秒之间')
      return
    }
    if (!draft.video.model.trim()) {
      setError('视频模型不能为空')
      return
    }
    if (!draft.script.model.trim()) {
      setError('剧本模型不能为空')
      return
    }
    if (draft.script.maxBeats < 1 || draft.script.maxBeats > 20) {
      setError('剧本最大幕数必须在 1..20 之间')
      return
    }
    if (draft.script.shotsPerBeat < 1 || draft.script.shotsPerBeat > 10) {
      setError('每幕分镜数必须在 1..10 之间')
      return
    }
    if (draft.danmaku.targetCount < 0 || draft.danmaku.targetCount > 10) {
      setError('弹幕目标条数必须在 0..10 之间')
      return
    }

    // 黑名单：按行切，去空行去重
    const blacklist = blacklistText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const payload: DraftConfig = {
      ...draft,
      video: {
        ...draft.video,
        characterLockPrompt: draft.video.characterLockPrompt?.trim() || undefined,
        referenceImageFileId: draft.video.referenceImageFileId?.trim() || undefined,
      },
      script: {
        ...draft.script,
        temperature: draft.script.temperature === undefined ? undefined : Number(draft.script.temperature),
      },
      danmaku: {
        ...draft.danmaku,
        blacklist,
        douyinRoomId: draft.danmaku.douyinRoomId?.trim() || undefined,
      },
    }

    setSaving(true)
    saveConfig(payload as AppConfig)
      .then((r) => {
        const d = draftFromConfig(r.config)
        setDraft(d)
        setBlacklistText(d.danmaku.blacklist.join('\n'))
        setMsg('✅ 已保存到 server/data/config.json')
      })
      .catch((e) => setError((e as Error).message || '保存失败'))
      .finally(() => setSaving(false))
  }

  return (
    <div className="app settings-page">
      <style>{STYLES}</style>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◤</span>
          <span className="brand-name">H3·LIVE</span>
          <span className="brand-sub">设置 / SETTINGS</span>
        </div>
        <div className="top-right">
          <Chip tone={loaded ? 'on' : 'warn'} dot>
            {loaded ? '已加载' : '加载中…'}
          </Chip>
          <a className="chip-link" href="/streamer?tab=config">
            ← 简略配置
          </a>
        </div>
      </header>

      <nav className="tab-nav" role="tablist">
        <Link to="/streamer?tab=workbench" className="tab-btn">
          <span className="tab-icon">◇</span><span className="tab-label">工作台</span>
        </Link>
        <Link to="/streamer?tab=config" className="tab-btn">
          <span className="tab-icon">◆</span><span className="tab-label">配置</span>
        </Link>
        <Link to="/streamer?tab=log" className="tab-btn">
          <span className="tab-icon">◇</span><span className="tab-label">日志</span>
        </Link>
        <span className="tab-btn active">
          <span className="tab-icon">◆</span><span className="tab-label">完整设置</span>
        </span>
      </nav>

      <div className="layout settings-layout">
        {!loaded ? (
          <Panel title="加载中…">
            <p className="hint dim">正在读取 server/data/config.json …</p>
            {error && <p className="hint err">❌ {error}</p>}
          </Panel>
        ) : (
          <>
            <Panel title="01 · API / 模式">
              <label className="field-label" htmlFor="cfg-api-key">
                MiniMax API Key
              </label>
              <div className="key-row">
                <input
                  id="cfg-api-key"
                  type="password"
                  placeholder="留空则不修改（服务端永远返回 *** 脱敏值）"
                  value={draft.apiKey}
                  onChange={(e) => update('apiKey', e.target.value)}
                />
              </div>
              <p className="hint dim">实际值仅 POST 写入磁盘；GET 响应一律脱敏成 ***。</p>
              <p className="hint dim" style={{ marginTop: 6 }}>
                测试 / 真实模式由服务端启动 <code>MOCK</code> / <code>H3_API_KEY</code> 环境变量决定，前端无法切换。
              </p>
            </Panel>

            <Panel title="02 · 视频生成">
              <label className="field-label" htmlFor="cfg-resolution">
                分辨率
              </label>
              <select
                id="cfg-resolution"
                value={draft.video.resolution}
                onChange={(e) => updateVideo('resolution', e.target.value as VideoResolution)}
              >
                <option value="480P">480P · 省成本 / 更快</option>
                <option value="768P">768P · 更清晰 / 更高成本</option>
              </select>

              <label className="field-label" htmlFor="cfg-duration" style={{ marginTop: 10 }}>
                单镜头时长（秒）
              </label>
              <input
                id="cfg-duration"
                type="number"
                min={1}
                max={60}
                value={draft.video.duration}
                onChange={(e) => updateVideo('duration', Number(e.target.value))}
              />

              <label className="field-label" htmlFor="cfg-video-model" style={{ marginTop: 10 }}>
                模型
              </label>
              <input
                id="cfg-video-model"
                type="text"
                placeholder="MiniMax-H3-Max"
                value={draft.video.model}
                onChange={(e) => updateVideo('model', e.target.value)}
              />

              <label className="field-label" htmlFor="cfg-video-seed" style={{ marginTop: 10 }}>
                随机种子（可选）
              </label>
              <input
                id="cfg-video-seed"
                type="number"
                placeholder="留空表示随机"
                value={draft.video.seed ?? ''}
                onChange={(e) => updateVideo('seed', e.target.value === '' ? undefined : Number(e.target.value))}
              />

              <label className="field-label" htmlFor="cfg-character-lock" style={{ marginTop: 10 }}>
                角色锁定提示词（可选）
              </label>
              <textarea
                id="cfg-character-lock"
                rows={3}
                placeholder="例如：阿光，二十岁男性，黑色短发，灰色夹克，左眉有疤"
                value={draft.video.characterLockPrompt ?? ''}
                onChange={(e) => updateVideo('characterLockPrompt', e.target.value)}
              />

              <label className="field-label" htmlFor="cfg-ref-image" style={{ marginTop: 10 }}>
                参考图 mm_file:// id（可选）
              </label>
              <input
                id="cfg-ref-image"
                type="text"
                placeholder="例如：1234567890"
                value={draft.video.referenceImageFileId ?? ''}
                onChange={(e) => updateVideo('referenceImageFileId', e.target.value)}
              />
            </Panel>

            <Panel title="03 · 剧本">
              <label className="field-label" htmlFor="cfg-script-model">
                文本模型
              </label>
              <input
                id="cfg-script-model"
                type="text"
                placeholder="MiniMax-M3"
                value={draft.script.model}
                onChange={(e) => updateScript('model', e.target.value)}
              />

              <label className="field-label" htmlFor="cfg-max-beats" style={{ marginTop: 10 }}>
                最大幕数（1..20）
              </label>
              <input
                id="cfg-max-beats"
                type="number"
                min={1}
                max={20}
                value={draft.script.maxBeats}
                onChange={(e) => updateScript('maxBeats', Number(e.target.value))}
              />

              <label className="field-label" htmlFor="cfg-shots-per-beat" style={{ marginTop: 10 }}>
                每幕分镜数（1..10）
              </label>
              <input
                id="cfg-shots-per-beat"
                type="number"
                min={1}
                max={10}
                value={draft.script.shotsPerBeat}
                onChange={(e) => updateScript('shotsPerBeat', Number(e.target.value))}
              />

              <label className="field-label" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={draft.script.injectDanmaku}
                  onChange={(e) => updateScript('injectDanmaku', e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                注入弹幕作为剧情输入
              </label>

              <label className="field-label" htmlFor="cfg-temperature" style={{ marginTop: 10 }}>
                Temperature（0..2，可选）
              </label>
              <input
                id="cfg-temperature"
                type="number"
                step={0.1}
                min={0}
                max={2}
                placeholder="留空使用模型默认"
                value={draft.script.temperature ?? ''}
                onChange={(e) =>
                  updateScript('temperature', e.target.value === '' ? undefined : Number(e.target.value))
                }
              />

              <label className="field-label" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={!!draft.script.thinking}
                  onChange={(e) => updateScript('thinking', e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                启用 thinking 模式
              </label>
            </Panel>

            <Panel title="04 · 弹幕">
              <label className="field-label" htmlFor="cfg-target-count">
                目标条数（0..10）
              </label>
              <input
                id="cfg-target-count"
                type="number"
                min={0}
                max={10}
                value={draft.danmaku.targetCount}
                onChange={(e) => updateDanmaku('targetCount', Number(e.target.value))}
              />

              <label className="field-label" htmlFor="cfg-blacklist" style={{ marginTop: 10 }}>
                黑名单词（每行一个）
              </label>
              <textarea
                id="cfg-blacklist"
                rows={4}
                placeholder={'广告\n诈骗\n刷屏'}
                value={blacklistText}
                onChange={(e) => setBlacklistText(e.target.value)}
              />

              <label className="field-label" htmlFor="cfg-min-length" style={{ marginTop: 10 }}>
                最短文本长度（1..50）
              </label>
              <input
                id="cfg-min-length"
                type="number"
                min={1}
                max={50}
                value={draft.danmaku.minLength}
                onChange={(e) => updateDanmaku('minLength', Number(e.target.value))}
              />

              <label className="field-label" htmlFor="cfg-min-interval" style={{ marginTop: 10 }}>
                同用户最小间隔 ms（0..60000）
              </label>
              <input
                id="cfg-min-interval"
                type="number"
                min={0}
                max={60000}
                step={100}
                value={draft.danmaku.minIntervalMs}
                onChange={(e) => updateDanmaku('minIntervalMs', Number(e.target.value))}
              />

              <label className="field-label" htmlFor="cfg-room-id" style={{ marginTop: 10 }}>
                抖音房间号（手动填入，dycast 接入用）
              </label>
              <input
                id="cfg-room-id"
                type="text"
                placeholder="留空则不接入"
                value={draft.danmaku.douyinRoomId ?? ''}
                onChange={(e) => updateDanmaku('douyinRoomId', e.target.value)}
              />
            </Panel>

            <Panel className="settings-actions">
              <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="primary" onClick={handleSave} disabled={saving}>
                  {saving ? '保存中…' : '💾 保存'}
                </button>
                <button onClick={handleBack} disabled={saving}>
                  ← 返回简略配置
                </button>
                {msg && <Chip tone="on">{msg}</Chip>}
                {error && <Chip tone="rec">❌ {error}</Chip>}
              </div>
              <p className="hint dim" style={{ marginTop: 8 }}>
                持久化路径：<code>server/data/config.json</code>，写入采用 temp + rename 原子方式。
              </p>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}
