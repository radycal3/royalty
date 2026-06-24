import { createClient } from '@/lib/supabase/server'
import { Circle } from 'lucide-react'

export default async function AdminHeader() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('nombre')
    .eq('id', user?.id)
    .single()

  const { data: periodo } = await supabase
    .from('periodos_operativos')
    .select('*')
    .eq('estado', 'abierto')
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single()

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00')
    const day = d.getDate()
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return `${day} ${months[d.getMonth()]}`
  }

  const periodoLabel = periodo
    ? `Semana ${periodo.numero_semana} · ${formatDate(periodo.fecha_inicio)}–${formatDate(periodo.fecha_fin)}`
    : 'Sin período activo'

  const estadoBadge = periodo?.estado === 'abierto'

  return (
    <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-6 print:hidden">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-text-secondary">{periodoLabel}</span>
        {periodo && (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
            estadoBadge ? 'bg-positive-bg text-positive' : 'bg-surface-alt text-text-muted'
          }`}>
            <Circle className="w-2 h-2 fill-current" />
            {estadoBadge ? 'Abierto' : 'Cerrado'}
          </span>
        )}
      </div>
      <span className="text-sm text-text-secondary">{usuario?.nombre ?? user?.email}</span>
    </header>
  )
}
