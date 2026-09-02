import fs from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from './minimaxError'

export { ApiError }

/** 从字符串中移除 apiKey，防止日志/回调泄露鉴权信息 */
function scrub(s: string, apiKey: string): string {
  if (!apiKey) return s
  return s.split(apiKey).join('***')
}

interface UploadResp {
  file?: { file_id?: number | string }
  base_resp?: { status_code?: number; status_msg?: string }
}

/**
 * MiniMax 统一鉴权客户端（文本 / 视频 / 文件共用一个 Bearer API Key）。
 * 所有出网调用都从这里走，方便统一错误处理与日志。
 */
export class MiniMaxClient {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.minimaxi.com',
    private onLog?: (msg: string) => void,
  ) {}

  async postJson<T = unknown>(apiPath: string, body: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + apiPath, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    return this.handle<T>(res)
  }

  async getJson<T = unknown>(apiPath: string): Promise<T> {
    const res = await fetch(this.baseUrl + apiPath, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(60_000),
    })
    return this.handle<T>(res)
  }

  /** 下载产物（content.url 有时效，须及时转存本地） */
  async download(url: string, dest: string): Promise<void> {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
    if (!res.ok) throw new ApiError(res.status, 'download_error', `下载失败: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, buf)
  }

  /** 上传视频生成输入素材（首帧图等），返回 mm_file://{file_id} 引用 */
  async uploadFile(filePath: string, purpose = 'video_generation_input'): Promise<string> {
    const buf = await fs.readFile(filePath)
    const form = new FormData()
    form.append('purpose', purpose)
    form.append('file', new Blob([buf]), path.basename(filePath))
    const res = await fetch(`${this.baseUrl}/v1/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    })
    // 先看状态码再看 body：失败响应可能不是 JSON
    const text = await res.text()
    let data: UploadResp | null = null
    try {
      data = text ? (JSON.parse(text) as UploadResp) : null
    } catch {
      /* 非 JSON */
    }
    if (!res.ok) {
      throw new ApiError(res.status, 'upload_error', `文件上传失败: HTTP ${res.status} ${text.slice(0, 200)}`)
    }
    const fileId = data?.file?.file_id
    if (fileId === undefined) throw new ApiError(500, 'upload_error', `文件上传响应缺少 file_id: ${text.slice(0, 200)}`)
    return `mm_file://${fileId}`
  }

  /** 校验 Key 是否有效（OpenAI 兼容的模型列表接口） */
  async validateKey(): Promise<boolean> {
    try {
      await this.getJson('/v1/models')
      return true
    } catch (e) {
      this.onLog?.(scrub(`Key 校验失败: ${(e as Error).message}`, this.apiKey))
      return false
    }
  }

  private async handle<T>(res: Response): Promise<T> {
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* 非 JSON 响应 */
    }
    if (!res.ok) {
      const err = data?.error
      throw new ApiError(
        res.status,
        err?.type ?? 'http_error',
        err?.message ?? `HTTP ${res.status}`,
        data?.request_id,
      )
    }
    return data as T
  }
}
