import type { ReactNode } from 'react'

/** 通用 UI 元件：Chip / Stat / Panel / StatusDot */

export function Chip({
  tone = '',
  dot,
  children,
}: {
  tone?: 'on' | 'warn' | 'rec' | ''
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={`chip${tone ? ` ${tone}` : ''}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: ReactNode
  unit?: string
  tone?: 'amber' | 'cyan' | 'dim'
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${tone === 'cyan' ? ' cyan' : tone === 'dim' ? ' dim' : ''}`}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  )
}

export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      {title && <h2 className="section-title">{title}</h2>}
      {children}
    </section>
  )
}

const DOT_TONE: Record<string, string> = {
  queued: '',
  running: 'pulse amber',
  ready: 'green',
  failed: 'red',
}

export function StatusDot({ status }: { status: string }) {
  const cls = DOT_TONE[status] ?? ''
  return <span className={`dot sm${cls ? ` ${cls}` : ''}`} title={status} />
}
