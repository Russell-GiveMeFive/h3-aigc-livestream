import { TextProvider } from '../providers/text'
import { Beat, StoryState, storySummary } from '../types'
import { extractJson } from '../util'

const CONTINUE_SYSTEM = `你是实时AIGC直播的AI编剧，负责续写下一拍剧情。以下是当前故事状态：
{story}
请生成下一拍剧情。输出必须只包含一个 JSON 对象，不要任何其他文字或代码围栏：
{"beat": {"summary": "本拍剧情一句话", "shots": [{"prompt": "视频生成提示词", "duration": 5}]}}
约束：
- 剧情必须承接上一拍，保持连贯，角色不能凭空消失或改变外貌
- 每个 beat 包含 1-2 个 shot，duration 为 5-8 秒（整数）
- shot.prompt 用中文写 80-150 字，必须包含：镜头语言（景别/运镜）、角色外貌描述（与角色列表一致）、动作、环境、情绪
- 剧情要有张力，为观众互动留出决策点`

/**
 * 续写器（M1 = AI 写模式）。
 * M2 将扩展为三种模式：ai / suggest（弹幕建议+AI写）/ crowd（纯弹幕写）。
 */
export async function continueStory(provider: TextProvider, state: StoryState): Promise<Beat> {
  const system = CONTINUE_SYSTEM.replace('{story}', storySummary(state))
  const raw = await provider.complete({
    system,
    messages: [{ role: 'user', content: '请续写下一拍剧情。' }],
    maxTokens: 2048,
    cacheSystem: true,
  })
  const parsed = extractJson<{ beat?: { summary?: string; shots?: { prompt?: string; duration?: number }[] } }>(raw)
  if (!parsed.beat) throw new Error('续写器输出缺少 beat 字段')
  const b = parsed.beat
  const shots = (b.shots ?? []).map((s, si) => ({
    id: `c${state.beats.length + 1}s${si + 1}`,
    beatId: `c${state.beats.length + 1}`,
    prompt: (s.prompt ?? '').trim(),
    duration: Math.min(Math.max(Number(s.duration ?? 5), 5), 15),
  }))
  if (!shots.length) throw new Error('续写器输出缺少 shots')
  return {
    id: `c${state.beats.length + 1}`,
    summary: (b.summary ?? '').trim() || `第 ${state.beats.length + 1} 拍`,
    shots,
  }
}
