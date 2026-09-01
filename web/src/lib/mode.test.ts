import { describe, expect, it } from 'vitest'
import { getEffectiveMode } from './mode'

describe('getEffectiveMode', () => {
  it('server 锁 mock → 测试（无视 session）', () => {
    expect(getEffectiveMode(true, null, false)).toBe('test')
    expect(getEffectiveMode(true, 'sess', false)).toBe('test')
    expect(getEffectiveMode(true, 'sess', true)).toBe('test')
  })

  it('server 不锁 + 无 session → 真实', () => {
    expect(getEffectiveMode(false, null, false)).toBe('real')
    expect(getEffectiveMode(null, null, false)).toBe('real')
  })

  it('server 不锁 + session mock=true → 测试', () => {
    expect(getEffectiveMode(false, 'sess', true)).toBe('test')
  })

  it('server 不锁 + session mock=false → 真实', () => {
    expect(getEffectiveMode(false, 'sess', false)).toBe('real')
  })

  it('server 状态未知 (null) 当作不锁', () => {
    expect(getEffectiveMode(null, 'sess', false)).toBe('real')
    expect(getEffectiveMode(null, 'sess', true)).toBe('test')
  })
})
