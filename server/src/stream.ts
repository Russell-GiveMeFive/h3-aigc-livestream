// 旧 stream.ts 已拆分为 domain/stream.ts（状态机）+ factory/streamFactory.ts（装配）。
// 保留本文件作为门面，旧 import 仍可工作。
export { LiveStream } from './domain/stream'
export type { StreamDeps, StreamConfig } from './domain/stream'