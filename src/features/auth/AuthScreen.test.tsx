import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthScreen } from './AuthScreen'
import { authService } from './auth-service'

vi.mock('./auth-service', () => ({
  authService: {
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendMagicLink: vi.fn(),
    sendPasswordReset: vi.fn(),
  },
}))

describe('AuthScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a password-reset request from the login screen', async () => {
    vi.mocked(authService.sendPasswordReset).mockResolvedValue({ data: {}, error: null })
    render(<AuthScreen />)

    fireEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), { target: { value: 'test@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Zurücksetz-Link senden/ }))

    await waitFor(() =>
      expect(authService.sendPasswordReset).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('reset=1'),
      ),
    )
    expect(await screen.findByText('E-Mail zum Zurücksetzen ist unterwegs')).toBeInTheDocument()
  })
})
