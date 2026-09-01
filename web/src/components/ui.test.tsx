import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Chip, Panel, Stat, StatusDot } from './ui'

describe('Chip', () => {
  it('renders children', () => {
    render(<Chip>hello</Chip>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('omits dot by default', () => {
    const { container } = render(<Chip>x</Chip>)
    expect(container.querySelector('.dot')).toBeNull()
  })

  it('renders dot when prop set', () => {
    const { container } = render(<Chip dot>x</Chip>)
    expect(container.querySelector('.dot')).not.toBeNull()
  })

  it.each(['on', 'warn', 'rec', ''] as const)('accepts tone="%s"', (tone) => {
    const { container } = render(<Chip tone={tone}>x</Chip>)
    expect(container.querySelector('.chip')).not.toBeNull()
  })
})

describe('Panel', () => {
  it('renders title as h2', () => {
    render(<Panel title="My Title"><span>child</span></Panel>)
    const h2 = screen.getByRole('heading', { level: 2, name: 'My Title' })
    expect(h2).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('omits title when not provided', () => {
    const { container } = render(<Panel><span>child</span></Panel>)
    expect(container.querySelector('h2')).toBeNull()
  })

  it('appends extra className', () => {
    const { container } = render(<Panel className="preview-panel">x</Panel>)
    expect(container.querySelector('.panel.preview-panel')).not.toBeNull()
  })
})

describe('Stat', () => {
  it('renders label and value', () => {
    render(<Stat label="弹幕" value={42} />)
    expect(screen.getByText('弹幕')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders unit when provided', () => {
    render(<Stat label="时长" value={5} unit="s" />)
    expect(screen.getByText('s')).toBeInTheDocument()
  })

  it.each(['amber', 'cyan', 'dim'] as const)('accepts tone="%s"', (tone) => {
    const { container } = render(<Stat label="l" value={1} tone={tone} />)
    expect(container.querySelector('.stat')).not.toBeNull()
  })
})

describe('StatusDot', () => {
  it('queued → no extra class', () => {
    const { container } = render(<StatusDot status="queued" />)
    const dot = container.querySelector('.dot.sm')
    expect(dot).not.toBeNull()
    expect(dot?.className).not.toMatch(/green|amber/)
  })

  it('running → pulse amber', () => {
    const { container } = render(<StatusDot status="running" />)
    expect(container.querySelector('.dot.sm.pulse.amber')).not.toBeNull()
  })

  it('ready → green', () => {
    const { container } = render(<StatusDot status="ready" />)
    expect(container.querySelector('.dot.sm.green')).not.toBeNull()
  })

  it('failed → red', () => {
    const { container } = render(<StatusDot status="failed" />)
    expect(container.querySelector('.dot.sm.red')).not.toBeNull()
  })
})