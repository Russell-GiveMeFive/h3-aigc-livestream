import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DanmakuFeed from './DanmakuFeed'
import type { Danmaku } from '../types'

const mkDm = (overrides: Partial<Danmaku>): Danmaku => ({
  id: '1',
  user: 'alice',
  text: 'hi',
  ts: Date.now(),
  ...overrides,
})

describe('DanmakuFeed', () => {
  it('renders empty state when no items', () => {
    render(<DanmakuFeed items={[]} />)
    expect(screen.getByText('等待观众发言…')).toBeInTheDocument()
  })

  it('shows the count of items in the header when liveStatus provided', () => {
    render(<DanmakuFeed items={[mkDm({}), mkDm({ id: '2' })]} liveStatus="live" />)
    expect(screen.getByText(/2 条/)).toBeInTheDocument()
  })

  it('truncates to the last 200 entries to keep DOM light', () => {
    const items = Array.from({ length: 250 }, (_, i) =>
      mkDm({ id: String(i), text: `m${i}` }),
    )
    render(<DanmakuFeed items={items} />)
    // ring 200：m0..m49 已丢；m50..m249 可见
    expect(screen.queryByText('m49')).not.toBeInTheDocument()
    expect(screen.getByText('m249')).toBeInTheDocument()
  })

  it('renders user and text for each item', () => {
    render(<DanmakuFeed items={[mkDm({ user: 'bob', text: 'hello' })]} />)
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('renders onCapture button when provided', () => {
    const onCapture = vi.fn()
    render(<DanmakuFeed items={[mkDm({ text: '抢沙发' })]} onCapture={onCapture} />)
    const btn = screen.getByRole('button', { name: /抓取弹幕/ })
    expect(btn).toBeInTheDocument()
  })

  it('fires onCapture when capture button clicked', async () => {
    const onCapture = vi.fn()
    render(<DanmakuFeed items={[mkDm({ id: 'X', text: '抢沙发' })]} onCapture={onCapture} />)
    await userEvent.click(screen.getByRole('button', { name: /抓取弹幕/ }))
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ id: 'X' }))
  })

  it('hides capture button when onCapture not provided', () => {
    render(<DanmakuFeed items={[mkDm({})]} />)
    expect(screen.queryByRole('button', { name: /抓取弹幕/ })).not.toBeInTheDocument()
  })

  it('disables capture button when id is in capturedIds', () => {
    const captured = new Set(['X'])
    render(
      <DanmakuFeed
        items={[mkDm({ id: 'X', text: 'hi' })]}
        onCapture={() => {}}
        capturedIds={captured}
      />,
    )
    expect(screen.getByRole('button', { name: '已抓取' })).toBeDisabled()
  })

  it('shows send form when onSend is provided', () => {
    render(<DanmakuFeed items={[]} onSend={() => {}} />)
    expect(screen.getByPlaceholderText('说点什么…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('hides send form when onSend is not provided', () => {
    render(<DanmakuFeed items={[]} />)
    expect(screen.queryByPlaceholderText('说点什么…')).not.toBeInTheDocument()
  })

  it('fires onSend(text) when user submits', async () => {
    const onSend = vi.fn()
    render(<DanmakuFeed items={[]} onSend={onSend} />)
    await userEvent.type(screen.getByPlaceholderText('说点什么…'), '  hi  ')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSend).toHaveBeenCalledWith('hi')
  })

  it('does not call onSend on whitespace-only input', async () => {
    const onSend = vi.fn()
    render(<DanmakuFeed items={[]} onSend={onSend} />)
    await userEvent.type(screen.getByPlaceholderText('说点什么…'), '   ')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('compact flag toggles .compact modifier class', () => {
    const { container } = render(<DanmakuFeed items={[]} compact />)
    expect(container.querySelector('.danmaku-panel.compact')).not.toBeNull()
  })

  it('renders status chip with tone by liveStatus', () => {
    const { rerender } = render(<DanmakuFeed items={[mkDm({})]} liveStatus="live" showHeader />)
    expect(screen.getByText('已连接')).toBeInTheDocument()
    rerender(<DanmakuFeed items={[mkDm({})]} liveStatus="mock" showHeader />)
    expect(screen.getByText('MOCK 流')).toBeInTheDocument()
    rerender(<DanmakuFeed items={[mkDm({})]} liveStatus="closed" showHeader />)
    expect(screen.getByText('已断开')).toBeInTheDocument()
  })
})