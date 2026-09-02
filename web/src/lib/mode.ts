/**
 * 顶部"测试 / 真实" chip 的判定规则。
 *
 * 规则：服务端启动级 mock（process.env.MOCK=1 / cfg.mock）一旦为 true，
 * session 端就算传真 key 也会被 OR 锁死（server/src/http/routes/workflow.ts:81
 * `sess.mock || envMock`）。所以 chip 必须反映**实际生效**的状态：
 *
 *   serverMock=true                          → 测试
 *   serverMock=false + 无 session            → 真实（没起 session 不会自动走 mock 路径）
 *   serverMock=false + session mock=true     → 测试（前端 mock 复选被我们删了，但字段保留兼容）
 *   serverMock=false + session mock=false    → 真实
 *
 * 前端没有 mock 切换入口（mode 完全由服务端 env 决定），
 * 这个函数是 chip 文案的唯一判定源。
 */
export type EffectiveMode = 'test' | 'real'

export function getEffectiveMode(
  serverMock: boolean | null,
  sessionId: string | null,
  sessionMock: boolean,
): EffectiveMode {
  if (serverMock === true) return 'test'
  if (sessionId && sessionMock) return 'test'
  return 'real'
}
