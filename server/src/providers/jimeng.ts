import type { Shot } from '@h3/protocol/types'
import type { VideoProvider, VideoGenOptions, VideoGenResult, FrameLinker } from '../interfaces/provider'

/**
 * 即梦 (火山引擎) 视频 Provider 占位实现：实现 VideoProvider 接口，文档和签名锁定，
 * 真正的 API 调用留到二开 P0 阶段（详见 docs/二开规划.md 第三节）。
 * 当前抛 NotImplementedError，避免误用。
 */
export class JimengHttpVideoProvider implements VideoProvider {
  readonly name: string
  constructor(opts: { model: string }) {
    this.name = `Jimeng/${opts.model}`
  }
  async generate(_shot: Shot, _opts: VideoGenOptions): Promise<VideoGenResult> {
    throw new Error('JimengHttpVideoProvider 尚未实现；请等待二开 P0 接入火山引擎 API')
  }
}

/** 即梦的"上传首帧"占位 stub：参考图上传落地时实现 uploadImage + mm_image://xx */
export class JimengFrameLinker implements FrameLinker {
  async extractLastFrame(_videoPath: string): Promise<string> {
    throw new Error('JimengFrameLinker 尚未实现；请等待二开参考图接入')
  }
}