import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useEffect } from 'react'
import { ArrowLeft, Info, X } from 'lucide-react'

export function Button({
  children,
  variant = 'primary',
  full = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  full?: boolean
}) {
  return (
    <button className={`button button--${variant} ${full ? 'button--full' : ''} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button className={`card card--interactive ${className}`} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <section className={`card ${className}`}>{children}</section>
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" {...props} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="input select" {...props}>{children}</select>
    </label>
  )
}

export function TextareaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <textarea className="input textarea" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

export function ScreenHeader({ title, eyebrow, onBack, action }: { title: string; eyebrow?: string; onBack?: () => void; action?: ReactNode }) {
  return (
    <header className="screen-header">
      <div className="screen-header__side">
        {onBack && <IconButton label="Zurück" onClick={onBack}><ArrowLeft size={20} /></IconButton>}
      </div>
      <div className="screen-header__copy">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      <div className="screen-header__side screen-header__side--right">{action}</div>
    </header>
  )
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__handle" />
        <div className="modal__header">
          <h2>{title}</h2>
          <IconButton label="Schließen" onClick={onClose}><X size={20} /></IconButton>
        </div>
        <div className="modal__content">{children}</div>
      </section>
    </div>
  )
}

export function ProgressBar({ value, tone = 'green' }: { value: number; tone?: 'green' | 'blue' | 'taupe' }) {
  return <div className="progress" aria-label={`${Math.round(value)} Prozent`}><span className={`progress__fill tone-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <div className="info-note"><Info size={17} aria-hidden="true" /><span>{children}</span></div>
}

export function LoadingScreen({ label = 'Bont wird vorbereitet' }: { label?: string }) {
  return (
    <main className="center-screen">
      <div className="brand-mark">B</div>
      <div className="loading-dots" aria-label={label}><span /><span /><span /></div>
      <p className="muted">{label}</p>
    </main>
  )
}

export function Metric({ label, value, detail, tone = 'neutral' }: { label: string; value: ReactNode; detail?: string; tone?: 'neutral' | 'green' | 'blue' | 'taupe' }) {
  return (
    <div className={`metric metric--${tone}`}>
      <span className="metric__label">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="metric__detail">{detail}</span>}
    </div>
  )
}
