/**
 * MiniMax API 错误：所有出网失败都被包装为 ApiError。
 * httpCode 直接对应导演/队列策略：402 余额致命、429/500/529/504 退避重试、422 触发改写。
 * 此类型仅供 providers/minimax.ts 内部抛出；上层用 ErrorPolicy.classify 决策。
 */
export class ApiError extends Error {
  constructor(
    public httpCode: number,
    public errorType: string,
    message: string,
    public requestId?: string,
  ) {
    super(message)
  }
}