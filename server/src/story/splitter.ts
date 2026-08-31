import { TextProvider } from '../providers/text'
import { Beat, Character, Shot, StoryState } from '../types'
import { extractJson } from '../util'

const SPLIT_SYSTEM = `你是实时AIGC直播的AI编剧。主播会提供一段剧情梗概，你要把它拆成若干"剧情拍"(beat)，并为每个拍生成1-2个视频分镜(shot)。
输出必须只包含一个 JSON 对象，不要任何其他文字或代码围栏：
{
  "title": "直播标题（一句话）",
  "world": "世界观一句话",
  "characters": [{"name": "角色名", "appearance": "外貌/服装描述（30-60字，视频生成时用于跨镜头角色一致）"}],
  "entities": ["剧情实体词表，10-20个名词/短语，用于后续判断弹幕是否与剧情相关"],
  "beats": [{"summary": "本拍剧情一句话", "shots": [{"prompt": "视频生成提示词", "duration": 5}]}]
}
约束：
- 生成 2-3 个 beat，之后的剧情由 AI 续写器继续
- 每个 beat 包含 1-2 个 shot，duration 为 5-8 秒（整数）
- shot.prompt 用中文写 80-150 字，必须包含：镜头语言（景别/运镜）、角色外貌描述（与 characters 一致）、动作、环境、情绪
- 剧情要有连续性，为后续互动留出"决策点"空间（例如角色面临的选择）`

export interface ScriptPlan {
  title: string
  world: string
  characters: Character[]
  entities: string[]
  beats: Beat[]
}

/** 剧本 → 分镜（首轮拆分，一次性） */
export async function splitScript(provider: TextProvider, premise: string): Promise<ScriptPlan> {
  const request = (thinking: boolean, maxTokens: number) => provider.complete({
    system: SPLIT_SYSTEM,
    messages: [{ role: 'user', content: `剧情梗概：\n${premise}` }],
    maxTokens,
    thinking,
    cacheSystem: true,
  })
  let raw = await request(true, 6144)
  let plan: {
    title?: string
    world?: string
    characters?: { name?: string; appearance?: string }[]
    entities?: string[]
    beats?: { summary?: string; shots?: { prompt?: string; duration?: number }[] }[]
  }
  try {
    plan = extractJson(raw)
  } catch {
    raw = await request(false, 6144)
    try {
      plan = extractJson(raw)
    } catch {
      throw new Error('剧本拆分失败：模型返回内容不完整，请缩短剧情梗概后重试')
    }
  }

  const beats: Beat[] = (plan.beats ?? []).map((b, bi) => ({
    id: `b${bi + 1}`,
    summary: (b.summary ?? '').trim() || `第 ${bi + 1} 拍`,
    shots: (b.shots ?? []).map((s, si) => ({
      id: `b${bi + 1}s${si + 1}`,
      beatId: `b${bi + 1}`,
      prompt: (s.prompt ?? '').trim(),
      duration: Math.min(Math.max(Number(s.duration ?? 5), 5), 15),
    })),
  }))

  return {
    title: (plan.title ?? '').trim() || 'AI 直播',
    world: (plan.world ?? '').trim(),
    characters: (plan.characters ?? [])
      .filter((c) => c.name)
      .map((c) => ({ name: String(c.name), appearance: String(c.appearance ?? '') })),
    entities: (plan.entities ?? []).map(String).slice(0, 40),
    beats,
  }
}
