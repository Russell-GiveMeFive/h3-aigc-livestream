export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function nowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 从模型输出中提取 JSON 对象（容忍 markdown 代码围栏与前后杂文） */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T
    } catch {
      // fallthrough
    }
  }
  throw new Error('模型输出不是有效 JSON')
}
