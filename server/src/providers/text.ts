import { MiniMaxClient } from './minimax'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CompleteOptions {
  system?: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  /** 默认 true：M3 深度思考；极速场景可传 false */
  thinking?: boolean
  /** 对 system 打 prompt cache 标记（续写时故事状态反复作为前缀，命中缓存省时省钱） */
  cacheSystem?: boolean
}

export interface TextProvider {
  readonly name: string
  complete(opts: CompleteOptions): Promise<string>
}

/** MiniMax-M3（Anthropic 兼容 Messages 格式） */
export class MiniMaxTextProvider implements TextProvider {
  readonly name = 'MiniMax'
  constructor(
    private client: MiniMaxClient,
    private model: string,
  ) {}

  async complete(opts: CompleteOptions): Promise<string> {
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

/** Mock 文本 Provider：无 Key 也能跑通全链路（MOCK=1） */
export class MockTextProvider implements TextProvider {
  readonly name = 'Mock'
  private continuedBeats = 0

  async complete(opts: CompleteOptions): Promise<string> {
    const isSplitter = opts.system?.includes('主播会提供一段剧情梗概') ?? false
    if (isSplitter) return this.split()
    return this.continue()
  }

  private split(): string {
    const beat = (i: number) => ({
      summary: `Mock 第 ${i} 拍：阿光在小镇集市发现神秘钥匙`,
      shots: [
        {
          prompt: `【测试镜头】像素风小镇集市，阿光（红发少年，蓝色外套）穿过人群，镜头中景跟随，暖色调，轻松氛围`,
          duration: 5,
        },
        {
          prompt: `【测试镜头】阿光低头发现地上发光的神秘钥匙，镜头推进特写，画面微暗，紧张氛围`,
          duration: 5,
        },
      ],
    })
    return JSON.stringify({
      title: 'Mock 像素小镇奇遇',
      world: '像素风小镇，居民友好，镇外有迷雾',
      characters: [{ name: '阿光', appearance: '红发少年，蓝色外套，白色运动鞋' }],
      entities: ['小镇', '阿光', '神秘钥匙', '集市', '迷雾', '老钟楼'],
      beats: [beat(1), beat(2)],
    })
  }

  private continue(): string {
    const i = 3 + this.continuedBeats++
    return JSON.stringify({
      beat: {
        summary: `Mock 第 ${i} 拍：阿光用钥匙打开老钟楼的门`,
        shots: [
          {
            prompt: `【测试镜头】阿光（红发少年，蓝色外套）站在老钟楼前，掏出神秘钥匙，镜头仰拍，黄昏光线`,
            duration: 5,
          },
          {
            prompt: `【测试镜头】钟楼大门缓缓打开，内部黑暗，阿光迈步进入，镜头跟随，神秘氛围`,
            duration: 5,
          },
        ],
      },
    })
  }
}
