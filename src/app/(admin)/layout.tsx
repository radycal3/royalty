import Sidebar from '@/components/layout/Sidebar'
import AdminHeader from '@/components/layout/AdminHeader'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      {/* print:ml-0 resetea el margen del sidebar en impresión */}
      <div className="ml-56 print:ml-0">
        <AdminHeader />
        <main className="p-6 print:p-0">{children}</main>
      </div>
    </div>
  )
}
