import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import LogConsole from './LogConsole'
import type { LogLine } from '../types'

const mkLog = (overrides: Partial<LogLine>): LogLine => ({
  ts: Date.now(),
  kind: 'info',
  msg: 'msg',
  ...overrides,
})

describe('LogConsole', () => {
  it('renders empty state', () => {
    render(<LogConsole logs={[]} />)
    expect(screen.getByText('等待流水事件…')).toBeInTheDocument()
  })

  it('renders one line per log entry', () => {
    const logs = [
      mkLog({ msg: 'first', kind: 'ok' }),
      mkLog({ msg: 'second', kind: 'err' }),
    ]
    render(<LogConsole logs={logs} />)
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('does NOT show stage by default (verbose off)', () => {
    const logs = [mkLog({ msg: 'with stage', stage: 'gen' })]
    const { container } = render(<LogConsole logs={logs} />)
    expect(within(container).queryByText('gen')).not.toBeInTheDocument()
  })

  it('shows stage + ms timestamp + danmakuId when verbose=true', () => {
    const logs = [mkLog({ msg: 'with stage', stage: 'gen', danmakuId: 'dm-1', clipId: 'shot-7', durationMs: 999 })]
    const { container } = render(<LogConsole logs={logs} verbose />)
    // stage chip — 用 selector 因为 span 文本是 "🎬 gen" 含 emoji
    expect(container.querySelector('.stage.stage-gen')).not.toBeNull()
    // danmakuId + clipId + durationMs meta
    expect(within(container).getByText('dm-1')).toBeInTheDocument()
    expect(within(container).getByText('shot-7')).toBeInTheDocument()
    expect(within(container).getByText('999ms')).toBeInTheDocument()
    // iso timestamp format HH:MM:SS.mmm
    const t = within(container).getByText(/\d{2}:\d{2}:\d{2}\.\d{3}/)
    expect(t).toBeInTheDocument()
  })

  it('renders clear button when onClear provided', () => {
    let clicks = 0
    render(<LogConsole logs={[mkLog({ msg: 'x' })]} onClear={() => { clicks++ }} />)
    screen.getByText('清空').click()
    expect(clicks).toBe(1)
  })

  it('hides clear button when onClear is missing', () => {
    render(<LogConsole logs={[]} />)
    expect(screen.queryByText('清空')).not.toBeInTheDocument()
  })
})