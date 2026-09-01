import type { Shot } from '@h3/protocol/types'

/** 文本生成（剧情拆分、续写、改写敏感词统一入口） */
export interface TextProvider {
  readonly name: string
  complete(opts: TextCompleteOptions): Promise<string>
}

export interface TextCompleteOptions {
  system?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number
  temperature?: number
  /** 默认 true：M3 深度思考；极速场景可传 false */
  thinking?: boolean
  /** 对 system 打 prompt cache 标记（续写时故事状态反复作为前缀，命中缓存省时省钱） */
  cacheSystem?: boolean
}

/** 视频生成 prompt 中的图片首帧引用；真实模式 mm_file://xxx，mock 模式本地 png 路径 */
export interface VideoGenOptions {
  firstFrame?: string
}

export interface VideoGenResult {
  localPath: string
  duration: number
}

/** 视频 Provider：异步提交 → 轮询 → 下载落盘（播放永远用本地文件） */
export interface VideoProvider {
  readonly name: string
  generate(shot: Shot, opts: VideoGenOptions): Promise<VideoGenResult>
}

/** 把"上一镜头的末帧"变成"下一镜头的首帧引用"，实现跨镜头视觉续接 */
export interface FrameLinker {
  /** 输入本地视频路径，返回首帧引用（mm_file:// 或本地 png） */
  extractLastFrame(videoPath: string): Promise<string>
}

/** 镜头时长约束（H3-Max 5~15，即梦 5/10 等离散值，由 Provider 各自实现） */
export interface ClipDurationPolicy {
  clamp(d: number): number
}