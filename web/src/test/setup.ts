import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// jsdom 已自带 sessionStorage，但每轮测试清前清
beforeEach(() => {
  sessionStorage.clear()
})