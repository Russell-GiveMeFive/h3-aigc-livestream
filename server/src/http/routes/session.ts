import express from 'express'
import type { Session, ApiDeps } from '../api'
import { nowId } from '../../util'

/** POST /api/session：内存保存用户的 apiKey + 标记 mock 模式 */
export function sessionRoutes(deps: ApiDeps): express.Router {
  const r = express.Router()

  r.post('/session', async (req, res) => {
    const apiKey = String(req.body?.apiKey ?? '').trim()
    const mock = req.body?.mock === true || !apiKey  // MOCK 模式：缺 key 也允许开播
    if (mock) {
      const session: Session = { id: nowId('sess'), apiKey: '', mock: true, stream: null }
      deps.sessions.set(session.id, session)
      return res.json({ sessionId: session.id, mock: true })
    }
    // 真实模式：调用 providerFactory 的 validateKey（这里暂时走最小校验）
    if (!apiKey) return res.status(400).json({ error: '请填写 API Key（文本 + 视频通用）' })
    const session: Session = { id: nowId('sess'), apiKey, mock: false, stream: null }
    deps.sessions.set(session.id, session)
    res.json({ sessionId: session.id, mock: false })
  })

  /** DELETE /api/session：销毁会话，回收 apiKey 内存；幂等 */
  r.delete('/session', async (req, res) => {
    const sessionId = String(req.headers['x-session-id'] ?? req.body?.sessionId ?? '')
    if (!sessionId) return res.status(400).json({ error: 'sessionId 必填' })
    const sess = deps.sessions.get(sessionId)
    if (!sess) return res.json({ ok: true }) // 幂等：不存在也算成功
    if (sess.stream) {
      try { await sess.stream.stop() } catch { /* swallow */ }
    }
    deps.sessions.delete(sessionId)
    res.json({ ok: true })
  })

  return r
}