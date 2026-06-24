'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ClipboardList } from 'lucide-react'

const nav = [
  { href: '/panel', label: 'Resumen', icon: LayoutDashboard, exact: true },
  { href: '/panel/stock', label: 'Conteo de stock', icon: ClipboardList, exact: false },
]

export default function EmpleadoNav() {
  const pathname = usePathname()

  return (
    <nav className="bg-surface border-b border-border px-6 flex gap-1">
      {nav.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              active
                ? 'border-brand text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
