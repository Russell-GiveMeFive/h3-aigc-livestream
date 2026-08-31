# H3·LIVE

实时 AIGC 直播服务：主播输入剧情梗概，由文本模型拆分/续写剧本，视频模型逐镜头生成片段，服务端缓冲后通过 RTMP 推送到 SRS，再以 HLS 提供给观众播放。

```text
主播浏览器
  └─ React 导演台
       └─ API Key + 剧情梗概 + 分辨率(480P/768P)
            ↓
服务端
  ├─ MiniMax-M3：剧本拆分 / 续写
  ├─ MiniMax-H3-Max：异步视频生成
  ├─ ffmpeg：首帧抽取 / RTMP 推流
  └─ 播放缓冲池
            ↓ RTMP
SRS（Docker）
            ↓ HLS
观众浏览器：React 放映厅 + hls.js
```

## 1. 环境要求

- Node.js 20 或更高版本
- npm
- Docker Desktop（用于运行 SRS）
- ffmpeg 和 ffprobe
- Python 3（仅 MOCK 模式生成场景卡片时使用）
- Python Pillow（仅 MOCK 模式需要）

检查依赖：

```bash
node -v
npm -v
docker --version
ffmpeg -version
ffprobe -version
python3 --version
```

安装项目依赖：

```bash
npm install
```

如果需要 MOCK 模式：

```bash
python3 -m pip install Pillow
```

## 2. 配置

复制配置模板：

```bash
cp .env.example .env
```

主要配置：

```env
# 真实模式；MOCK=1 可免 API Key 跑演示
MOCK=0

TEXT_MODEL=MiniMax-M3
VIDEO_MODEL=MiniMax-H3-Max

# 主播端也可以逐场选择 480P/768P；此项是未指定时的默认值
VIDEO_RESOLUTION=480P

GEN_CONCURRENCY=2
TARGET_BUFFER_SEC=30
POLL_INTERVAL_MS=3000
MAX_RETRIES=2
```

真实模式下，API Key 通过主播页面输入，仅保存在服务端内存中，不写入磁盘。视频生成需要 MiniMax 视频按量付费余额，H3-Max 的 480P/768P 都会消耗视频额度。

## 3. 启动方式

### 3.1 生产方式启动（推荐）

需要启动两个组件：SRS 和 Node 服务。

终端一：启动 SRS：

```bash
npm run srs
```

终端二：启动服务：

```bash
npm start
```

启动成功后访问：

- 主播导演台：http://127.0.0.1:3000/streamer
- 观众放映厅：http://127.0.0.1:3000/viewer
- 健康检查：http://127.0.0.1:3000/api/health

当前默认是 `MOCK=0`，即真实 MiniMax API 模式。主播开播后，导演台会生成房间码并提供观众入口。

### 3.2 MOCK 模式启动（推荐首次验证）

MOCK 模式不需要 MiniMax API Key，会用本地 PIL + ffmpeg 生成可读的场景卡片视频，验证剧本、队列、首帧抽取、播放和推流链路。

终端一：

```bash
npm run srs
```

终端二：

```bash
MOCK=1 npm start
```

然后打开主播台，点击“接入”（MOCK 模式不需要填写 Key），输入剧情并开始直播。

### 3.3 开发模式（前端热更新）

```bash
npm run dev
```

开发模式会同时启动：

- 后端：http://127.0.0.1:3000
- Vite 前端：http://127.0.0.1:5173

Vite 会把 `/api`、`/ws` 和 `/clips` 代理到后端。开发时建议访问：

- http://127.0.0.1:5173/streamer
- http://127.0.0.1:5173/viewer

如果只需要前端热更新，也可以单独运行：

```bash
npm run dev:web
```

此时需要另开一个终端运行后端：

```bash
npm run dev:server
```

## 4. 如何停止服务

### 4.1 停止 Node 服务

如果服务运行在当前终端，直接按：

```text
Ctrl + C
```

`npm run dev` 启动的前后端也可以使用 `Ctrl + C` 一起停止。

如果 Node 服务在后台运行，可以查找并停止监听 3000 端口的进程：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill <PID>
```

如果进程没有退出，再使用：

```bash
kill -9 <PID>
```

### 4.2 停止 SRS

停止并移除 SRS 容器：

```bash
npm run srs:down
```

查看 SRS 是否仍在运行：

```bash
docker ps --filter name=h3-srs
```

也可以直接停止容器：

```bash
docker stop h3-srs
```

### 4.3 完整停止顺序

建议顺序：

```text
1. 在 Node 服务终端按 Ctrl+C
2. npm run srs:down
```

直播会话和房间状态保存在内存中，重启 Node 服务后，旧房间码会失效，需要重新开播生成新房间。

## 5. 主播使用流程

1. 打开 http://127.0.0.1:3000/streamer
2. 输入 MiniMax API Key（真实模式）
3. 点击“接入”验证 Key
4. 输入直播标题和剧情梗概
5. 选择视频分辨率：
   - `480P`：成本更低、生成更快
   - `768P`：画面更清晰、成本更高
6. 点击“开始直播”
7. 等待剧本拆分和首批视频生成
8. 将页面显示的房间码或观众入口发给观众
9. 在导演台查看：
   - 各幕剧本
   - 各镜头生成状态
   - 视频预览和胶片墙
   - 缓冲水位
   - 生成延迟
   - 实时流水日志

分辨率是“本场直播”的设置。开播后后端状态和观众端顶部都会显示实际使用的档位。

## 6. 观众使用流程

1. 打开 http://127.0.0.1:3000/viewer
2. 输入主播提供的房间码
3. 观众端自动连接 HLS
4. 页面显示当前直播状态、分辨率、缓冲、已生成镜头和剧情拍

观众不能修改视频生成分辨率；观众播放的是主播本场已经生成并推送的 HLS 流。

观众可以在放映厅底部发送弹幕。弹幕通过当前房间 WebSocket 广播，主播导演台和同一房间的其他观众会实时看到。服务端会限制单条弹幕最多 120 个字符，并限制同一连接每 800ms 最多发送一条。

如果观众提前进入房间，页面会自动等待开播信号。如果 HLS 临时断开，会自动退避重连。直播失败或结束后会停止轮询和重连。

## 7. 常用命令

```bash
# 安装依赖
npm install

# 生产构建
npm run build

# TypeScript 类型检查
npm run typecheck

# Mock 端到端自检，不启动 HTTP 服务
npm run selftest

# 启动 SRS
npm run srs

# 停止 SRS
npm run srs:down

# 生产模式启动 Node 服务
npm start

# 开发模式：后端 + Vite
npm run dev
```

## 8. API 与实时协议

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/session` | 创建会话并校验 API Key；MOCK 模式免 Key |
| POST | `/api/stream/start` | 创建直播，支持 `resolution: 480P/768P` |
| POST | `/api/stream/stop` | 停止直播并清理房间 |
| GET | `/api/stream/status?room=xxx` | 返回直播状态、分幕剧本、镜头状态、片段列表 |
| GET | `/clips/<file>` | 播放主播端生成的视频片段，支持 Range |
| GET | `/api/health` | 查看服务是否正常及是否 MOCK 模式 |
| WS | `/ws?room=xxx` | 推送日志、剧情拍、视频片段、状态、错误和房间弹幕；客户端发送 `{ "type": "danmaku", "text": "..." }` |

开播请求示例：

```json
{
  "sessionId": "sess_xxx",
  "title": "末日实验室",
  "script": "主角在废土中找到一座地下实验室……",
  "resolution": "480P"
}
```

## 9. 项目结构

```text
server/src/
  providers/
    minimax.ts       MiniMax HTTP 客户端与统一错误
    text.ts          M3 文本 Provider 与 Mock Provider
    video.ts         H3-Max 异步视频任务与 Mock 视频
  story/
    splitter.ts      首轮剧本拆分
    continuer.ts     剧情续写
    director.ts      缓冲水位导演循环
  gen/
    queue.ts         并发生成队列、重试、首帧续接
    frameLink.ts     ffmpeg 抽帧与 MiniMax 文件上传
  playout/
    engine.ts        播放缓冲池
    push.ts          RTMP 推流器
  http/api.ts        REST API 与视频预览服务
  ws/rooms.ts        直播间事件总线
  stream.ts          单直播流组合根
  index.ts           HTTP / WebSocket 服务入口

web/
  src/pages/
    StreamerPage.tsx 主播导演台
    ViewerPage.tsx   观众放映厅
  src/components/
    BeatsTimeline.tsx 分幕剧本与镜头状态
    ClipWall.tsx      视频预览胶片墙
    LogConsole.tsx    实时日志
  src/stores/         Zustand 状态
  src/styles/         控制室视觉系统

scripts/
  selftest.ts         Mock 端到端自检
  mock_card.py        Mock 场景卡片生成

srs.conf              SRS RTMP/HLS 配置
docker-compose.yml    SRS Docker 配置
```

## 10. 故障排查

### 页面打不开

```bash
curl http://127.0.0.1:3000/api/health
```

如果没有返回 JSON，检查 Node 服务是否启动；如果只启动了 Vite，访问 5173 端口。

### 观众端显示“信号中断”

依次检查：

1. 房间码是否为本次开播的新房间
2. 主播是否真正点击了“开始直播”
3. 主播端是否有已生成片段
4. SRS 是否运行：

```bash
docker ps --filter name=h3-srs
```

5. HLS 地址是否可以访问：

```bash
curl -I http://127.0.0.1:8080/live/<room>.m3u8
```

### 真实模式视频全部失败

如果日志出现：

```text
insufficient balance (1008)
```

说明 MiniMax 视频按量余额不足。文本模型可以正常工作，但 H3/H3-Max 视频生成仍需要视频额度。请充值后重新开播，或者使用：

```bash
MOCK=1 npm start
```

### 房间码失效

房间和会话是内存状态。Node 服务重启、崩溃或被停止后，旧房间码会失效，需要主播重新接入并开播。

## 11. 当前范围与后续计划

当前为 M1 主循环：

- AI 剧本拆分
- AI 剧情续写
- H3-Max 视频生成
- 480P/768P 选择
- 首帧续接
- 播放缓冲
- RTMP/HLS
- 主播端剧本和视频监控
- 观众端自动重连

后续计划：

- 弹幕接入和剧情相关性过滤
- `AI写` / `人工弹幕作为建议输入AI写` / `纯人弹幕写`
- 导演审核和分支选择
- 严格镜头顺序重排
- AbortController 取消长任务
- 无缝衔接推流
- session TTL 和缓存自动清理
- 音色和语音生成
