import { createClient } from '@/lib/supabase/server'
import { Crown } from 'lucide-react'
import LogoutButton from '@/components/layout/LogoutButton'

export default async function EmpleadoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('nombre')
    .eq('id', user?.id)
    .single()

  return (
    <div className="min-h-screen bg-surface-alt">
      <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <Crown className="w-5 h-5 text-brand" />
          <span className="text-base font-bold text-text-primary tracking-tight">ROYALTY</span>
          <span className="text-sm text-text-muted ml-2">Panel Equipo</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-text-secondary">{usuario?.nombre ?? user?.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-6">{children}</main>
    </div>
  )
}
