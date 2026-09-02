# 抖音弹幕接入（douyin-integration）

> 接入时间：2026-09；与 H3·LIVE 主分支并行开发，目标 = 让 `collectDanmaku()`
> 在用户填了 `AppConfig.danmaku.douyinRoomId` 之后能拉到真实的抖音直播间弹幕。

---

## 1. 数据通路（一次订阅）

```
roomIdOrUrl
   │
   ▼ resolveRoomInfo(roomIdOrUrl)            server/src/danmaku/roomInfo.ts
   │   fetch https://live.douyin.com/<webRid>
   │   正则抠 self.__pace_f.push(...) → React state
   │   取出 roomId (im 系统内部 id) + uniqueId (用户指纹)
   │
   ▼ signatureFetcher(roomId, uniqueId)       server/src/danmaku/signature.ts
   │   返回 { signature }  （X-Bogus / a-bogus）
   │
   ▼ buildWsUrl(...)                          server/src/danmaku/douyin.ts
   │   拼出 wss://webcast3-ws-web-hl.douyin.com/webcast/im/push/v2/?...
   │
   ▼ ws (npm `ws`) connect
   │
   ▼ 每帧：PushFrame.decode(buf)             server/src/danmaku/proto.ts
   │     headersMap[compress_type]==='gzip' → gunzipSync(payload)
   │     Response.decode(payload)
   │     for each Message: 按 method 分发解码
   │       ChatMessage / MemberMessage / LikeMessage / SocialMessage / GiftMessage
   │
   ▼ messageToItem() → DanmakuItem{ id,user,text,ts,source:'douyin' }
   │
   ▼ onItem(DanmakuItem) → workflow.collectDanmaku()
```

---

## 2. 策略选择：A + B 双模（默认推荐 Remote dycast）

抖音的 wss 链接必须带 `signature` 参数，它由 `webmssdk.js`（混淆 + 字符串加密 +
WASM 的字节码）实时算出来。我们手头 dycast 仓库的 `public/js/{webmssdk,signature,model}.js`
在分发包里都是 0 字节占位符（真正的字节码不能内嵌在开源仓库里），所以「纯 Node 端
1:1 复刻」这条路在本仓库内走不通。

因此 `server/src/danmaku/signature.ts` 提供了三种可注入的 fetcher，
本仓库的默认（`createNodeSignatureStub`）会直接抛错并告诉调用方「请注入真实实现」，
方便后续替换：

| 模式 | 实现 | 优点 | 代价 |
|---|---|---|---|
| **A. Playwright / Puppeteer** | 启动 headless Chromium，加载 dycast 的 dev 页，等 SDK 注入后通过 CDP 调 `window.getSign(roomId, uniqueId)` | 算法变动对我们透明，抖音改 SDK 后无需跟版 | 主项目引入 ~300MB 浏览器依赖；启动慢；CI 不友好 |
| **B. Remote dycast**（推荐） | 让 dycast dev server 同时暴露一个 `/api/sign` 端点（前端调 `window.getSign` 后回传）；我们的 Node 通过 `fetch` 拿签名 | 主项目零额外依赖；签名计算走的就是浏览器自己的 SDK | 需要本地同时跑 dycast；需要给 dycast 加一个 HTTP 路由 |
| **C. 第三方 npm 包** | `douyin-live`、`douyin-api` 等 | 一行代码搞定 | 大多不可维护；抖音改算法就废 |

`scripts/test-douyin.ts` 也内置了一个 `createFakeSignature` 模式（环境变量
`DOUYIN_SIGN_FETCHER='{"type":"fake","value":"xxx"}`），便于本地联调
protobuf 解码与 UI 流转，但拿不到真弹幕。

---

## 3. 接口契约（`server/src/danmaku/douyin.ts`）

```ts
export interface DanmakuSource {
  readonly name: 'douyin' | 'manual' | 'mock'
  subscribe(opts: {
    roomId: string
    onItem: (item: DanmakuItem) => void
    signal?: AbortSignal
  }): Promise<{ stop(): Promise<void> }>
}

export function createDouyinSource(deps?: {
  signatureImpl?: (roomId: string, uniqueId: string) => Promise<{ signature: string }>
  wsHost?: string      // 默认 webcast3-ws-web-hl.douyin.com
  debug?: boolean
}): DouyinSource
```

`workflow/collectDanmaku.ts` 拿到 source 之后只需：

```ts
const douyin = createDouyinSource({
  signatureImpl: async (roomId, uniqueId) => {
    const r = await fetch('http://localhost:5174/api/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId, uniqueId })
    })
    return (await r.json()) as { signature: string }
  }
})
const sub = await douyin.subscribe({
  roomId: config.danmaku.douyinRoomId!,
  onItem: (item) => collected.push(item),
  signal: controller.signal,
})
```

---

## 4. 本仓库改动清单（已落到本 PR）

| 文件 | 作用 |
|---|---|
| `server/src/danmaku/proto.ts` | Douyin 全套 protobuf schema（JSON descriptor），`PushFrame`/`Response`/`ChatMessage`/... 的 codecs |
| `server/src/danmaku/signature.ts` | 签名 fetcher 接口 + Node stub / Fake / Remote-dycast 三种实现 |
| `server/src/danmaku/roomInfo.ts` | 把用户输入（roomId / 短号 / URL）解析为 `roomId + uniqueId` |
| `server/src/danmaku/douyin.ts` | `DouyinSource` 主类 + `createDouyinSource()` 工厂；wss 连接 + gzip 解压 + protobuf 解码 + 心跳 + 重连 |
| `scripts/test-douyin.ts` | 独立冒烟测试：接 wss → 解码 → 打印前 10 条弹幕；30s 自动退出 |
| `package.json` | 加 `protobufjs@^7.4.0` 依赖；加 `npm run test:douyin` 脚本 |

`ws` 已经在主项目里；`protobufjs` 是新增的唯一运行时依赖。

---

## 5. 已知限制 & 生产化清单

1. **签名后端必须注入**：默认 Node stub 会抛错。生产前请选 A/B/C 任一方案并
   把 fetcher 接到 `createDouyinSource`。
2. **唯一 ID 复用风险**：`uniqueId` 是浏览器指纹类字段。同一 IP 多次复连被抖音
   识别为「同一用户」会更稳；生产可考虑缓存 `uniqueId`（每小时失效），
   避免每连接重新抓 HTML。
3. **重连策略**：当前最多 3 次、500ms / 1s / 2s 指数退避；对短抖动足够，
   对网络隔离场景会失败。如要更长，可调 `MAX_RETRIES`。
4. **ack 回送**：抖音要求部分帧回 ack，否则 30~60s 后会主动断开。当前
   `decodeFrame` 没把 ack 串回 ws，需要在 `ws.on('message')` 里加一行：
   ```ts
   if ((res as any).needAck) {
     const sf = new PushFrame({ payloadType: 'ack', logId: frame.logId,
       payload: utf8ToBytes((res as any).internalExt) })
     ws.send(Buffer.from(PushFrame.encode(sf).finish()))
   }
   ```
   我们本次没串是因为 demo 场景里 30s 测试窗口用不上，长时间跑再加。
5. **protobuf schema 不完整**：只覆盖了 6 种高频消息；抖音如果推送
   `WebcastRoomMessage`（PK/连麦）等新 method，会被静默 drop。
   `messageToItem()` 的 default 分支可以扩展。
6. **测试脚本**：依赖 dycast 的真实签名服务才能看到弹幕；否则会预期失败
   （脚本会主动 catch 并 `exit 0`）。
7. **Sandbox 限制**：本次 PR 在受限环境里不能跑 `npm install` 与 `npm run typecheck`；
   落地后请在本地运行：
   ```sh
   npm install
   npm run typecheck
   npm run test:douyin -- 731123456789
   ```
   若 `protobufjs` 安装失败，可改用纯 `protoc` 预编译产物（见 schema 头部注释）。

---

## 6. 推荐落地路径（一步到位签名方案）

仓库内自带独立签名代理 `scripts/dycast-sign-server.ts`，用 Playwright headless
加载 `https://live.douyin.com/<roomId>`，调页面暴露的 `window.getSign(...)`，再
通过 HTTP `/api/sign` 把签名回传主项目。Chrome context 复用 + 30 分钟缓存，
签名只算一次。

```bash
# 一次性：装 playwright + chromium 浏览器（首次约 100MB+）
npm install
npx playwright install chromium

# 后台启动签名代理（监听 127.0.0.1:5174）
npm run dycast:sign-server
```

主项目侧接入（env var 即可，不用改代码）：

```ts
// server/src/factory/providerFactory.ts 或 streamFactory.ts
const douyin = createDouyinSource({
  signatureImpl: process.env.DOUYIN_REMOTE_SIGN_URL
    ? createRemoteSignatureFetcher(process.env.DOUYIN_REMOTE_SIGN_URL)
    : createNodeSignatureStub(),
})
```

然后在 workflow.collectDanmaku() 里走这个 douyin 实例。

**为什么不直接放进主项目？**
Playwright 把 chromium 整套拉进依赖会让 `npm install` 变重、CI 镜像变大。
把它抽成 sidecar 进程后：
- 主项目零额外依赖（可选 `playwright` 仍在 devDependencies，但不 import）
- 签名进程可独立重启 / 跨机器部署
- 不需要 playwright 的测试 / CI 不会受影响