import { describe, expect, it, vi } from 'vitest'
import { getUserMessage, logError, UserFacingError } from './errors'

describe('error boundary helpers', () => {
  it('prefers an explicit user-facing message', () => {
    expect(getUserMessage(new UserFacingError('Bitte später erneut versuchen.'))).toBe('Bitte später erneut versuchen.')
  })

  it('hides technical network details', () => {
    expect(getUserMessage(new Error('Failed to fetch'))).toContain('Verbindung')
  })

  it('logs context without changing the user message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logError('test', new Error('boom'))
    expect(spy).toHaveBeenCalledWith('[bont] test', expect.any(Error))
    spy.mockRestore()
  })
})
