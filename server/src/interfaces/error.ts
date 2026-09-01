/** 错误严重度：决定 GenQueue 是退避重试、改写后重试、还是立即终止流水线 */
export type ErrorSeverity = 'fatal' | 'retryable' | 'swallow'

/**
 * Provider 错误分类器：把任意异常映射到严重度。
 * 注入到 GenQueue 后，队列无需识别特定错误类型（解耦 Provider 实现细节）。
 */
export interface ErrorPolicy {
  classify(err: unknown): ErrorSeverity
}