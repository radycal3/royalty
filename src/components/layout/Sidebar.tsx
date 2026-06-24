'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  Upload,
  Beef,
  Receipt,
  Package,
  Users,
  Bike,
  FlaskConical,
  Settings,
  LogOut,
  Crown,
  UtensilsCrossed,
} from 'lucide-react'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/importar', label: 'Importar Pedix', icon: Upload },
  { href: '/productos', label: 'Productos', icon: Beef },
  { href: '/gastos', label: 'Gastos', icon: Receipt },
  { href: '/stock', label: 'Stock', icon: Package },
  { href: '/equipo', label: 'Equipo', icon: Users },
  { href: '/consumo-interno', label: 'Consumo interno', icon: UtensilsCrossed },
  { href: '/cadetes', label: 'Cadetes', icon: Bike },
  { href: '/laboratorio', label: 'Laboratorio', icon: FlaskConical },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="fixed top-0 left-0 h-screen w-56 bg-sidebar flex flex-col z-30 print:hidden">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5">
        <Crown className="w-6 h-6 text-brand" />
        <span className="text-lg font-bold text-white tracking-tight">ROYALTY</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-sidebar-active text-white'
                  : 'text-text-sidebar hover:bg-sidebar-hover hover:text-white'
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 space-y-0.5">
        <Link
          href="/configuracion"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            pathname.startsWith('/configuracion')
              ? 'bg-sidebar-active text-white'
              : 'text-text-sidebar hover:bg-sidebar-hover hover:text-white'
          }`}
        >
          <Settings className="w-[18px] h-[18px] shrink-0" />
          Configuración
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-sidebar hover:bg-sidebar-hover hover:text-white transition-colors"
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
