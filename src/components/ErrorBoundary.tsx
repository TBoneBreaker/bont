import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui'
import { logError } from '../lib/errors'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError('Nicht behandelter UI-Fehler', { error, componentStack: info.componentStack })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <main className="center-screen">
        <div className="brand-mark">B</div>
        <div>
          <h1>Etwas ist schiefgelaufen</h1>
          <p className="muted">Bont konnte diesen Bereich nicht laden. Deine lokal gespeicherten Daten bleiben erhalten.</p>
        </div>
        <Button onClick={() => window.location.reload()}>Neu laden</Button>
      </main>
    )
  }
}
