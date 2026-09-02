# H3·LIVE

实时 AIGC 直播服务：**主播从抖音弹幕 / 手动输入 → 文本模型拆分剧本 → 视频模型逐镜头生成 → 缓冲后 RTMP 推 SRS → HLS 给观众**。

```text
主播浏览器
  └─ React 导演台（3 tab：工作台 / 配置 / 日志）
       ├─ 接入：API Key + 剧情梗概
       ├─ 收集弹幕：抖音 wss / 手动添加
       ├─ 提交 → 剧本 → 确认 → 视频片段
       ↓ HTTP/WS
服务端（3000）
  ├─ 工作流状态机（collect → submit → confirm → generate）
  ├─ MiniMax-M3：剧本拆分 / 续写 / 弹幕分类
  ├─ MiniMax-H3-Max：异步视频生成
  ├─ ffmpeg：首帧抽取 / RTMP 推流
  └─ 播放缓冲池（RoomHub + GenQueue）
            ↓ RTMP
SRS（Docker）
            ↓ HLS
观众浏览器：React 放映厅 + hls.js
```

## 1. 环境要求

- Node.js 20 或更高
- npm
- Docker Desktop（运行 SRS）
- ffmpeg / ffprobe
- Python 3 + Pillow（仅 `MOCK=1` 生成场景卡片时需要）

```bash
node -v && npm -v && docker --version && ffmpeg -version && ffprobe -version && python3 --version
```

## 2. 安装与配置

```bash
npm install
cp .env.example .env
```

`.env` 关键字段（详见 `.env.example`）：

```env
MOCK=0                      # 1 = 本地 mock（无需 Key），0 = 真实 MiniMax API
TEXT_MODEL=MiniMax-M3
VIDEO_MODEL=MiniMax-H3-Max
VIDEO_RESOLUTION=480P       # 480P/768P；主播端也可单场覆盖
GEN_CONCURRENCY=2
TARGET_BUFFER_SEC=30
POLL_INTERVAL_MS=3000
DOUYIN_ROOM_ID=10776146386  # 抖音房间号；空 = 不接抖音
DANMAKU_TARGET_COUNT=5      # 单次收集条数
```

API Key **不在 `.env` 里**——由主播在导演台"接入"页输入，存到 `server/data/config.json`（`.gitignore` 已排除）。真实模式下服务端 GET 返回 `***xxx` 末 4 位，写入路径走 `saveConfig`，前端/服务端都做 mask 兜底（详见 `docs/douyin-integration.md` 之外的代码注释：`server/src/configStore.ts`）。

## 3. 启动方式

### 3.1 开发模式（推荐）

```bash
npm run dev      # 后端 3000 + Vite 5173（predev 自动清端口）
```

- 主播台：http://127.0.0.1:5173/streamer
- 观众端：http://127.0.0.1:5173/viewer?room=xxx
- 主播台是单页 3 tab（query `?tab=` 切）：**工作台 / 配置 / 日志**

### 3.2 生产模式

```bash
npm run srs                    # 终端一
npm start                      # 终端二
```

- 主播台：http://127.0.0.1:3000/streamer
- 观众端：http://127.0.0.1:3000/viewer?room=xxx

### 3.3 MOCK 演示（无 API Key）

```bash
MOCK=1 npm run srs
MOCK=1 npm start
```

MOCK 模式本地生成可读场景卡片验证剧本 → 队列 → 首帧 → RTMP 全链路，不消耗视频额度。

## 4. 主播使用流程（工作流驱动）

不再是"开播自动循环"——现在每轮工作流都要手动驱动一或多个动作：

1. 打开 http://127.0.0.1:5173/streamer，点"**接入**"验证 API Key
2. 在"**配置**" tab 调整视频参数 / 分辨率（每场直播分辨率独立）
3. 切到"**工作台**" tab，按下面 4 步手动推进：

| 步骤 | 动作 | 阶段 |
|---|---|---|
| ① **收集** | 点"收集弹幕" — 抖音 wss 拉一批（按 `DANMAKU_TARGET_COUNT`）| `collecting_danmaku` → `reviewing_danmaku` |
| ② **提交** | 勾选用哪几条，点"提交生成剧本" | → `generating_script` → `reviewing_beats` |
| ③ **确认** | 编辑各拍 summary / shot prompt，点"确认并生成" | → `generating_clips` |
| ④ **生成** | 点"开始生成视频片段"（本轮已自动驱动，可在后台跑）| → `completed` |

可任意时刻手动加弹幕 / 删弹幕，编辑 prompt，确认后生成。剧本一旦确认，会**自动归档**到 `scriptHistory`（`shared/types.ts:176`），后续只读显示在剧本面板顶部折叠区。

## 5. 观众使用流程

1. 打开 http://127.0.0.1:5173/viewer
2. 输入主播给的房间码
3. 自动连 HLS；中途断开自动退避重连
4. 底部可发弹幕（单条 ≤120 字符，每连接 ≤ 1 条/800ms）；主播台同房间所有观众实时收到

## 6. 停止服务

```bash
# Node 服务：Ctrl+C（dev 模式前后端一起停）
# 或：lsof -nP -iTCP:3000 -sTCP:LISTEN && kill <PID>

# SRS：
npm run srs:down
docker ps --filter name=h3-srs
```

重启 Node 服务后旧房间码失效，需重开。

## 7. 常用命令

```bash
npm run dev          # 后端 + Vite（含 predev 清端口）
npm run dev:server   # 仅后端（tsx watch）
npm run dev:web      # 仅前端
npm start            # 生产模式
npm run srs          # docker compose up -d srs
npm run srs:down

npm run typecheck    # 前后端独立 tsc --noEmit
npm run build        # typecheck + vite build
npm test             # vitest run（前后端单元测试）
npm run test:watch
npm run selftest     # Mock 端到端自检，不启动 HTTP
npm run test:douyin  # 抖音 wss 接入冒烟

npm run clear:ports  # 手动清 3000 / 5173 / 5174
```

## 8. API 与实时协议

### 8.1 REST

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/session` | 创建会话并校验 Key（`MOCK=1` 免 Key） |
| GET / POST | `/api/config` | 读 / 写持久化配置（apiKey 走 mask） |
| POST | `/api/stream/start` | 开播（含 `resolution: 480P/768P`） |
| POST | `/api/stream/stop` | 停播 |
| GET | `/api/stream/status?room=xxx` | 房间状态 / 剧本 / 镜头 / 片段 |
| GET | `/clips/<file>` | 播放生成的视频片段（支持 Range） |
| GET | `/api/health` | 服务健康 + MOCK 标志 |
| GET | `/api/history` | 历史房间 / 视频列表 |

### 8.2 工作流 REST（手动驱动）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/workflow/collect` | 收集弹幕（按 `DANMAKU_TARGET_COUNT`） |
| POST | `/api/workflow/submit-danmaku` | 提交勾选的弹幕 → 生成剧本 |
| POST | `/api/workflow/confirm-beats` | 确认 beats（含编辑后版本） |
| POST | `/api/workflow/generate-clips` | 入队生成视频片段 |
| POST | `/api/workflow/add-danmaku` | 手动加弹幕 |
| POST | `/api/workflow/remove-danmaku` | 手动删弹幕 |
| POST | `/api/workflow/recover` | error → reviewing_danmaku（保留数据） |
| POST | `/api/workflow/reset` | 清空整个工作流 |

### 8.3 WebSocket

`/ws?room=xxx` 推送：

```ts
type WsEvent =
  | { type: 'log'; msg: string }
  | { type: 'clip'; id; shotId; duration; url }
  | { type: 'beat'; summary; shots }
  | { type: 'phase'; phase: StreamPhase; msg? }
  | { type: 'error'; msg }
  | { type: 'danmaku'; id; user; text; ts }
  | { type: 'workflow'; phase: WorkflowPhase; detail? }
```

客户端可发 `{ type: 'danmaku', text: '...' }`。

## 9. 项目结构

```
server/src/
  workflow/        ← 核心：工作流状态机
    handlers.ts        collect/submit/confirm/generate/add/remove/recover/reset
    stateMachine.ts    8 阶段 + 4 动作，状态迁移图
    store.ts           per-room WorkflowState（纯内存）
    danmakuClassifier.ts  M3 / 启发式判定弹幕相关性
  danmaku/         ← 抖音 wss 接入
    douyin.ts / proto.ts / roomInfo.ts / decode.ts / signature.ts
    sdk/               webmssdk + sign + acSignature（vendored）
  history/         ← 历史房间 / 视频持久化
  factory/         ← providerFactory / streamFactory（DI）
  domain/          ← stream / shotIndex
  http/routes/     ← 按领域拆：session / settings / static / stream / workflow / history
  providers/       ← minimax / text / video / jimeng
  story/ + gen/ + playout/ + ws/
  index.ts / app.ts / stream.ts / config.ts / configStore.ts

web/src/pages/
  StreamerPage.tsx       ← 顶层 state + WS + 3 tab 切换
  streamer/
    Workbench.tsx        ← 工作台（剧本编辑 + 历史折叠 + clip 网格）
    ConfigTab.tsx        ← 配置（高频参数）
    LogTab.tsx           ← 日志（verbose 时间戳 + stage emoji）
  ViewerPage.tsx        ← 观众放映厅
  HistoryPage.tsx       ← 历史房间列表
  SettingsPage.tsx      ← 设置（完整字段）
  components/           ← BeatsTimeline / ClipWall / LogConsole / 共用 UI
  stores/                ← Zustand 状态
  styles/               ← streamer.css + base.css（控制室视觉系统）

shared/types.ts         ← 前后端共享协议
docs/                   ← douyin-integration.md / 二开规划.md / 迭代报告.md
scripts/                ← selftest / clear-dev-ports / probe_room / dycast-*
```

## 10. 工作流状态机

```
idle
  ├─ collect ───► collecting_danmaku ───► reviewing_danmaku
                                              │
                                              ├─ submit_danmaku ──► generating_script
                                              │                          │
                                              │                          ▼
                                              │                    reviewing_beats
                                              │                          │
                                              ├─ submit_danmaku ──────►  │
                                              │                          │
                                              │                          ├─ confirm_beats ──► generating_clips
                                              │                          │                         │
                                              │                          │                         ├─ all done ──► completed
                                              │                          │                         └─ any fatal ──► error
                                              │                          │
                                              └─ reset ◄── idle (always) ─┘
                                          error ◄── recover ── reviewing_danmaku
```

数据：`workflowStore`（per-room `WorkflowState`）+ `roomResources`（providers + GenQueue + apiKey 缓存）+ `roomMutex`（per-room 串行）+ `generatingTasks`（per-room in-flight flag）。

## 11. 故障排查

### 主播台打不开 / API 502
先看后端：`curl http://127.0.0.1:3000/api/health`；`predev` 没杀掉旧 dev 进程时 3000/5173 会被占，`npm run clear:ports` 或手动 `taskkill /F /PID <pid>`（见 `scripts/clear-dev-ports.cjs`）。

### 收集弹幕超时 / 失败
- `DOUYIN_ROOM_ID` 是否填了真实房间号
- `server/src/danmaku/douyin.ts` 的 wss 接入偶尔被抖音风控，失败会冒到工作流 `error` 阶段；点"恢复"回到 `reviewing_danmaku` 再试
- 想看抖音原始响应：`npm run test:douyin` 或 `tsx scripts/probe_room.ts`

### 视频全部失败 / insufficient balance (1008)
真实 API 余额不足。`MOCK=1 npm start` 可继续演示；生产前到 MiniMax 控制台充值。

### 房间码失效
Node 重启 → 内存房间清空，主播重新接入 + 收弹幕。

## 12. 当前范围与后续计划

### M1 主循环（已闭环，2026-09-01）
- AI 剧本拆分 / 续写
- H3-Max 视频生成（480P / 768P）
- 首帧续接
- 播放缓冲 + RTMP/HLS
- 主播端剧本 / 视频监控
- 观众端自动重连

### M2 手动工作流 + 弹幕接入（当前阶段，2026-09-02）
- 8 阶段手动工作流（collect → submit → confirm → generate）
- 抖音 wss 弹幕接入（无 sign-server，纯 Node vm 算 X-Bogus）
- 弹幕分类（相关性过滤 + 黑名单 + 去重）
- 剧本历史归档（确认即推入 `scriptHistory`，UI 折叠只读）
- 手动加 / 删弹幕
- 3 tab 主播台（工作台 / 配置 / 日志）
- 实时 WebSocket 阶段推送

### 后续
- 三种续写模式落地（AI / 弹幕建议 / 纯人弹幕）
- 导演分支选择（剧情多线）
- 严格镜头顺序重排
- AbortController 取消长任务
- 无缝衔接推流（帧级 cut）
- session TTL + 缓存自动清理
- 音色 / TTS / 语音生成
- 多分辨率混推