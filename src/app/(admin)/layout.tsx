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
      <div className="ml-56">
        <AdminHeader />
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
