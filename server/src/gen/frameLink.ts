import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { MiniMaxClient } from '../providers/minimax'
import type { FrameLinker } from '../interfaces/provider'

const execFileAsync = promisify(execFile)

/** 真实模式：抽末帧 → 上传 Files API → mm_file://{file_id}（H3-Max 图生视频首帧） */
export class MiniMaxFrameLinker implements FrameLinker {
  constructor(
    private client: MiniMaxClient,
    private opts: { cacheDir: string; ffmpeg: string; onLog?: (msg: string) => void },
  ) {}

  async extractLastFrame(videoPath: string): Promise<string> {
    const png = path.join(this.opts.cacheDir, `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`)
    await extractLastFrame(videoPath, png, this.opts.ffmpeg)
    this.opts.onLog?.('🔗 已抽取上一镜头末帧，上传作为下一镜头首帧...')
    const ref = await this.client.uploadFile(png, 'video_generation_input')
    return ref
  }
}

/** Mock 模式：仍走 ffmpeg 抽帧验证代码路径，但返回本地路径（mock 视频 provider 忽略） */
export class MockFrameLinker implements FrameLinker {
  constructor(private opts: { cacheDir: string; ffmpeg: string }) {}

  async extractLastFrame(videoPath: string): Promise<string> {
    const png = path.join(this.opts.cacheDir, `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`)
    await extractLastFrame(videoPath, png, this.opts.ffmpeg)
    return png
  }
}

async function extractLastFrame(videoPath: string, outPng: string, ffmpeg: string): Promise<void> {
  await fs.mkdir(path.dirname(outPng), { recursive: true })
  await execFileAsync(ffmpeg, ['-y', '-sseof', '-0.5', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPng])
  const stat = await fs.stat(outPng)
  if (!stat.size) throw new Error('ffmpeg 未生成有效末帧文件')
}
