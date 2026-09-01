import { MiniMaxClient } from './minimax'
import type { TextProvider, TextCompleteOptions } from '../interfaces/provider'

/** 兼容旧 API 名称（外部 import 可能还在用） */
export type CompleteOptions = TextCompleteOptions
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

/** MiniMax-M3（Anthropic 兼容 Messages 格式） */
export class MiniMaxTextProvider implements TextProvider {
  readonly name = 'MiniMax'
  constructor(
    private client: MiniMaxClient,
    private model: string,
  ) {}

  async complete(opts: TextCompleteOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: opts.thinking === false ? { type: 'disabled' } : { type: 'adaptive' },
    }
    if (opts.system) {
      body.system = [
        {
          type: 'text',
          text: opts.system,
          ...(opts.cacheSystem ? { cache_control: { type: 'ephemeral' } } : {}),
        },
      ]
    }
    if (opts.temperature !== undefined) body.temperature = opts.temperature

    const resp = await this.client.postJson<{ content: { type: string; text?: string }[] }>(
      '/anthropic/v1/messages',
      body,
    )
    return resp.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('')
      .trim()
  }
}

/**
 * Mock 文本 Provider 拆成两个角色：
 *   - MockSplitterText：响应 StorySplitter.split() 调用
 *   - MockContinuerText：响应 StoryContinuer.continue() 调用
 * 拆分后无需再靠 system prompt 字面量判别分支（消除旧 string-match 黑魔法）。
 * 都满足 TextProvider 接口，但具体语境不同（mock 用脚本上下文建好的 story 状态）。
 */

/** 共享工具：从用户剧情梗概里抽取主角名 + 关键词实体 */
function extractProtagonist(text: string): string {
  const isBadTail = (s: string) => /[女子之的着了个是在于]/.test(s)
  const m1 = text.match(/^主角(?:是|叫|名为)?[「"'\s]*([一-龥A-Za-z]{2,4})(?=[，的在于到上里来面前后\s.,:!?]|$)/)
  if (m1?.[1] && !isBadTail(m1[1])) return m1[1].slice(0, 3)
  const m2 = text.match(/([一-龥A-Za-z]{2,3})[，]?(?:是|为)主角/)
  if (m2?.[1] && !isBadTail(m2[1])) return m2[1]
  const m3 = text.match(/(?:玩家|主角|用户)?(?:扮演|饰演|是)([一-龥A-Za-z]{2,3})(?:穿越|踏入|经历|探索|面对|进入|来到|开始|发现|醒来|陷入|在|，|$)/)
  if (m3?.[1] && !isBadTail(m3[1])) return m3[1]
  const verbs = ['穿越', '扮演', '踏上', '经历', '探索', '面对', '进入', '来到', '开始', '发现', '醒来', '陷入', '在']
  for (const v of verbs) {
    const idx = text.indexOf(v)
    if (idx < 3) continue
    const before = text.slice(0, idx)
    const t2 = before.match(/[一-龥A-Za-z0-9]{2}$/)
    if (t2?.[0] && !verbs.includes(t2[0]) && !isBadTail(t2[0])) return t2[0]
    const t3 = before.match(/[一-龥A-Za-z0-9]{3}$/)
    if (t3?.[0] && !verbs.includes(t3[0]) && !isBadTail(t3[0])) return t3[0]
  }
  return '主角'
}

function extractEntities(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const t = s.trim()
    if (t.length < 2 || t.length > 5) return
    if (!/^[一-龥A-Za-z0-9]+$/.test(t)) return
    if (seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  const parts = text.split(/[，。；：！？、…\s]+/).filter(Boolean)
  for (const raw of parts) {
    const part = raw.replace(/^(?:主角|玩家|用户|主人公|男主|女主)/, '')
    if (part.length < 2) continue
    const maxPrefix = Math.min(3, part.length)
    for (let len = maxPrefix; len >= 2; len--) push(part.slice(0, len))
    const tail = part.match(/[一-龥A-Za-z0-9]{2,3}$/)
    if (tail) push(tail[0])
  }
  return out.length ? out.slice(0, 12) : ['剧情', '关键', '线索']
}

function buildMockPlan(premise: string) {
  const titleSrc = premise
    .replace(/^主角(?:是|叫|名为)?[「"'\s]*[一-龥A-Za-z]{2,5}[的」"'\s]+/, '')
    .replace(/^(?:玩家|用户)(?:扮演|饰演)/, '')
    .trim() || premise
  const titleBase = titleSrc.replace(/\s+/g, ' ').slice(0, 24) || 'Mock 直播'
  const title = (titleBase.match(/^[^\s，。；]+/) ?? [titleBase])[0]
  const world = premise.slice(0, 120)
  const protagonist = extractProtagonist(premise)
  const rawEntities = extractEntities(premise)
  const badForTag = (e: string) =>
    e === protagonist ||
    /^[在于到里是为]/.test(e) ||
    e.endsWith('在') || /[了过]$/.test(e) ||
    /^[一-龥]{0,2}[地里的]/.test(e)
  const tagPool = Array.from(new Set(rawEntities.filter((e) => !badForTag(e)))).slice(0, 9)
  const entities = [protagonist, ...tagPool]
  const cast = [{ name: protagonist, appearance: '由主播梗概隐含塑造；视频生成时锚定关键外貌词' }]
  const tag = (i: number) => tagPool[i % Math.max(1, tagPool.length)] ?? '关键线索'
  const setting = `「${premise.slice(0, 50)}」`
  const beat = (i: number, summarySuffix: string) => ({
    summary: `${title.slice(0, 14)} · 第 ${i} 拍：${summarySuffix}`,
    shots: [
      {
        prompt: `【用户场景】${protagonist}登场，所在：${setting}。镜头中景缓慢推进，${protagonist}与「${tag(0)}」互动，环境色调柔和，建立世界观氛围`,
        duration: 5,
      },
      {
        prompt: `【用户场景】${protagonist}在场景中发现「${tag(1)}」，镜头推进特写，${protagonist}的表情和动作对「${tag(2)}」做出反应，画面转微暗，紧张氛围浮现`,
        duration: 5,
      },
    ],
  })
  return {
    title: title || 'AI 直播',
    world,
    characters: cast,
    entities,
    beats: [beat(1, '建立场景与人物，引入关键元素'), beat(2, '角色展开行动，制造第一个决策点')],
  }
}

/**
 * 兼容旧入口：以前一个 MockTextProvider 同时处理 split 和 continue，现在统一包成
 * 一个同时满足 StorySplitter+StoryContinuer 行为需要的 TextProvider。
 * 内部维护 continuedBeats 计数与已生成的 plan 状态。
 */
export class MockTextProvider implements TextProvider {
  readonly name = 'Mock'
  private continuedBeats = 0
  private plan: ReturnType<typeof buildMockPlan> = {
    title: '未命名直播',
    world: '',
    characters: [],
    entities: [],
    beats: [],
  }

  /** 直接由 splitter 调：把梗概注入并把 plan 写入 this.plan */
  setPlan(premise: string): ReturnType<typeof buildMockPlan> {
    this.plan = buildMockPlan(premise)
    this.continuedBeats = 0
    return this.plan
  }

  async complete(opts: TextCompleteOptions): Promise<string> {
    const userText = opts.messages.map((m) => m.content).join('\n')
    // splitter 路径：user message 用 <premise>...</premise> 标签包裹（见 splitter.ts:24），
    // 从中抽取 premise；不依赖易变的"请把以下..."前缀文案。
    const premiseMatch = userText.match(/<premise>([\s\S]*?)<\/premise>/)
    if (premiseMatch) {
      const premise = premiseMatch[1].trim()
      const plan = this.setPlan(premise)
      return JSON.stringify(plan)
    }
    // continuer 路径
    const i = 3 + this.continuedBeats++
    const t = this.plan
    const ent = t.entities.filter((e) => e !== t.characters[0]?.name)
    const subject = ent[(i - 3) % Math.max(1, ent.length)] ?? '关键线索'
    const main = t.characters[0]?.name ?? '主角'
    return JSON.stringify({
      beat: {
        summary: `${t.title.slice(0, 14)} · 第 ${i} 拍：${main} 面对「${subject}」带来的抉择`,
        shots: [
          {
            prompt: `【用户场景】${main} 在上一拍基础上推进，因「${subject}」触发选择，镜头中景跟随，${main}做出关键动作并引出后续冲突，情绪递进`,
            duration: 5,
          },
        ],
      },
    })
  }
}