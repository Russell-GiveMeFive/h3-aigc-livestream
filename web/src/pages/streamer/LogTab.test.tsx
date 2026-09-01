import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LogTab from './LogTab'
import { useStreamer } from '../../stores/streamerStore'

describe('LogTab', () => {
  beforeEach(() => {
    useStreamer.getState().reset()
  })

  it('renders toggle + clear + count', () => {
    render(<LogTab />)
    expect(screen.getByText(/显示更多详情/)).toBeInTheDocument()
    // "容量 300" hint
    expect(screen.getByText(/容量 300/)).toBeInTheDocument()
    // count of 0
    expect(screen.getByText('0 条 · 容量 300')).toBeInTheDocument()
  })

  it('shows log content via the console', () => {
    useStreamer.getState().addLog('hello-from-store')
    render(<LogTab />)
    expect(screen.getByText('hello-from-store')).toBeInTheDocument()
    expect(screen.getByText('1 条 · 容量 300')).toBeInTheDocument()
  })

  it('toggles verbose: clicking shows stage chip when logs have stage', async () => {
    useStreamer.getState().addLog('gen ok', 'ok', { stage: 'gen' })
    const { container } = render(<LogTab />)
    // before toggle: no stage label
    expect(container.querySelector('.stage')).toBeNull()
    // toggle on: click the wrapping label (implicit label association via .log-tab-toggle)
    await userEvent.click(screen.getByText(/显示更多详情/))
    // .stage span should now render
    expect(container.querySelector('.stage.stage-gen')).not.toBeNull()
  })

  it('clear button empties the log buffer', async () => {
    useStreamer.getState().addLog('a')
    useStreamer.getState().addLog('b')
    render(<LogTab />)
    expect(screen.getByText(/2 条/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('清空'))
    expect(screen.getByText('0 条 · 容量 300')).toBeInTheDocument()
  })
})