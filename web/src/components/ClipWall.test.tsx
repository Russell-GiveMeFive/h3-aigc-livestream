import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ClipWall from './ClipWall'
import type { ClipView } from '../types'

const mkClip = (overrides: Partial<ClipView>): ClipView => ({
  id: 'c1',
  shotId: 'shot-1',
  url: '/clips/shot-1.mp4',
  duration: 5,
  readyAt: 0,
  ...overrides,
})

describe('ClipWall', () => {
  it('renders empty hint when no clips and showPlayer=false', () => {
    render(<ClipWall clips={[]} activeUrl={null} onSelect={() => {}} />)
    expect(screen.getByText('尚未生成任何片段')).toBeInTheDocument()
  })

  it('does NOT render the main video by default (showPlayer=false)', () => {
    const { container } = render(
      <ClipWall clips={[mkClip({})]} activeUrl="/clips/x.mp4" onSelect={() => {}} />,
    )
    expect(container.querySelector('video.preview-player')).toBeNull()
  })

  it('renders the main video only when showPlayer=true and activeUrl is set', () => {
    const { container } = render(
      <ClipWall
        clips={[mkClip({})]}
        activeUrl="/clips/x.mp4"
        onSelect={() => {}}
        showPlayer
      />,
    )
    expect(container.querySelector('video.preview-player')).not.toBeNull()
  })

  it('deduplicates clips with the same id', () => {
    const clips = [
      mkClip({ id: 'a' }),
      mkClip({ id: 'a' }),
      mkClip({ id: 'b' }),
    ]
    render(<ClipWall clips={clips} activeUrl={null} onSelect={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('marks the active film cell with aria-pressed=true', () => {
    render(
      <ClipWall
        clips={[mkClip({ id: 'a', url: '/clips/a.mp4' }), mkClip({ id: 'b', url: '/clips/b.mp4' })]}
        activeUrl="/clips/b.mp4"
        onSelect={() => {}}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true')
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false')
  })

  it('fires onSelect with the clicked clip url', async () => {
    const onSelect = vi.fn()
    render(
      <ClipWall
        clips={[mkClip({ id: 'a', url: '/clips/a.mp4' })]}
        activeUrl={null}
        onSelect={onSelect}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('/clips/a.mp4')
  })
})