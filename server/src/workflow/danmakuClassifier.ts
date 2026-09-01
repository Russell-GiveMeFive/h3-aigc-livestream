import type { TextProvider } from '../interfaces/provider'

export interface ClassifierContext {
  /** 当前剧本梗概（premisse）；缺省时用 "interactive story" 兜底 */
  premise?: string
  /** 注入 provider；为 null/undefined 时走启发式 */
  provider?: TextProvider
}

export interface ClassifierResult {
  relevant: boolean
  /** 0..1 */
  relevance: number
}

const CLASSIFY_SYSTEM = `你是互动故事弹幕相关性评分助手。给你一段剧情梗概和一条观众弹幕，请判断这条弹幕与剧情是否相关。
只输出一行 JSON（不要任何其它文字/代码围栏）：
{"relevant": true|false, "score": 0.0..1.0, "reason": "一句中文理由"}
score 越接近 1 表示越能启发后续剧情/分支。`

/** classify: 用 provider 做语义打分；缺 provider 走长度启发式 */
export async function classify(text: string, ctx: ClassifierContext = {}): Promise<ClassifierResult> {
  const trimmed = text.trim()
  if (!trimmed) return { relevant: false, relevance: 0 }
  if (!ctx.provider) {
    // 启发式：长度越长越像思路型弹幕；纯短词（666 / 来了）不相关
    const score = Math.min(1, trimmed.length / 20)
    return { relevant: trimmed.length > 4, relevance: Number(score.toFixed(2)) }
  }
  const premise = (ctx.premise ?? '').trim() || '互动故事（观众通过弹幕影响剧情走向）'
  try {
    const raw = await ctx.provider.complete({
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `剧情梗概：${premise}\n弹幕：${trimmed}\n请输出 JSON。`,
        },
      ],
      thinking: false,
      maxTokens: 256,
    })
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('no json in classifier output')
    const parsed = JSON.parse(m[0]) as { relevant?: boolean; score?: number }
    const score = Math.max(0, Math.min(1, Number(parsed.score ?? 0)))
    return { relevant: Boolean(parsed.relevant ?? score > 0.4), relevance: Number(score.toFixed(2)) }
  } catch {
    // 模型失败回落到启发式
    const score = Math.min(1, trimmed.length / 20)
    return { relevant: trimmed.length > 4, relevance: Number(score.toFixed(2)) }
  }
}
