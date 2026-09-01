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

  it('shows the count of items in the header', () => {
    render(<DanmakuFeed items={[mkDm({}), mkDm({ id: '2' })]} />)
    expect(screen.getByText('2 条')).toBeInTheDocument()
  })

  it('truncates to the last 80 entries to keep DOM light', () => {
    const items = Array.from({ length: 120 }, (_, i) =>
      mkDm({ id: String(i), text: `m${i}` }),
    )
    render(<DanmakuFeed items={items} />)
    // only most recent 40 visible (item 80..119); older "m0" hidden
    expect(screen.queryByText('m0')).not.toBeInTheDocument()
    expect(screen.getByText('m119')).toBeInTheDocument()
  })

  it('renders user and text for each item', () => {
    render(<DanmakuFeed items={[mkDm({ user: 'bob', text: 'hello' })]} />)
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
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
})