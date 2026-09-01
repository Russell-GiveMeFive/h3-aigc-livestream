#!/usr/bin/env node
// 启动 dev 前清理常驻端口占用的进程。
// 为什么需要：tsx watch 热重启时旧 server listener 没 release，新的就 EADDRINUSE；
// Ctrl+C 关 concurrently 时子进程没死透也会残留。
// 策略：netstat -ano 找 LISTENING PID → taskkill /F（Windows）。
// 跨平台注意：本项目只在 Windows 开发机跑，taskkill 是 Win 特定。
// 不再依赖 grep（Windows cmd 没有），用 JS 正则解析 netstat 输出。

const { execSync } = require('node:child_process')

const PORTS = [3000, 5173, 5174] // 5174 是 vite 端口冲突时的备选

function listPids(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' })
    const pids = new Set()
    // netstat 行形如：
    //   "  TCP    127.0.0.1:3000    0.0.0.0:0    LISTENING    31360"
    //   "  TCP    [::1]:5173        [::]:0       LISTENING    35788"
    // 端口在 ":" 之后、空白之前。用 :(端口)\s 锚定，避免 3000 撞 30000。
    const re = new RegExp(`:${port}\\s.*LISTENING\\s+(\\d+)`)
    for (const line of out.split('\n')) {
      const m = line.match(re)
      if (m) pids.add(m[1])
    }
    return [...pids]
  } catch {
    return []
  }
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let totalKilled = 0
for (const port of PORTS) {
  const pids = listPids(port)
  if (!pids.length) continue
  for (const pid of pids) {
    const ok = killPid(pid)
    if (ok) {
      console.log(`[clear-ports] killed PID ${pid} (port ${port})`)
      totalKilled++
    }
  }
}

if (totalKilled === 0) {
  console.log('[clear-ports] ports clean')
} else {
  console.log(`[clear-ports] ${totalKilled} process(es) terminated`)
}