'use client'

import { ReactNode, useState } from 'react'
import { X } from 'lucide-react'

// ─── Tabs ───

export function Tabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: { key: string; label: string }[]
  activeTab: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex gap-1 bg-surface-alt rounded-lg p-1 w-fit">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === t.key
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Side Panel ───

export function SidePanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface border-l border-border shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-alt text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ─── Form Field ───

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string
  children: ReactNode
  hint?: string
  error?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
      {error && <p className="text-xs text-negative mt-1">{error}</p>}
    </div>
  )
}

// ─── Input ───

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-colors text-sm ${props.className ?? ''}`}
    />
  )
}

// ─── Select ───

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-colors text-sm ${props.className ?? ''}`}
    >
      {props.children}
    </select>
  )
}

// ─── Button ───

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  children: ReactNode
}) {
  const base = 'font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  const variants = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'bg-surface-alt text-text-primary border border-border hover:bg-surface',
    danger: 'bg-negative text-white hover:bg-red-700',
    ghost: 'text-text-secondary hover:text-text-primary hover:bg-surface-alt',
  }
  return (
    <button {...props} className={`${base} ${sizes[size]} ${variants[variant]} ${props.className ?? ''}`}>
      {children}
    </button>
  )
}

// ─── Badge ───

export function Badge({
  children,
  color = 'gray',
}: {
  children: ReactNode
  color?: 'gray' | 'green' | 'red' | 'yellow'
}) {
  const colors = {
    gray: 'bg-surface-alt text-text-muted',
    green: 'bg-positive-bg text-positive',
    red: 'bg-negative-bg text-negative',
    yellow: 'bg-warning-bg text-warning',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[color]}`}>
      {children}
    </span>
  )
}

// ─── Empty State ───

export function EmptyState({
  message,
  title,
  description,
  icon,
  action,
}: {
  message?: string
  title?: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="text-center py-12">
      {icon && <div className="flex justify-center mb-3 text-text-muted">{icon}</div>}
      {title && <p className="text-sm font-medium text-text-primary">{title}</p>}
      {description && <p className="text-sm text-text-muted mt-1">{description}</p>}
      {message && <p className="text-sm text-text-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── Toast ───

export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function show(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  function Toast() {
    if (!toast) return null
    return (
      <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
        toast.type === 'success' ? 'bg-positive text-white' : 'bg-negative text-white'
      }`}>
        {toast.message}
      </div>
    )
  }

  return { show, Toast }
}
