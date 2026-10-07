import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  // Public routes
  if (path === '/login') {
    if (user) {
      // Logged in user on login page → redirect to app
      const { data: usuario } = await supabase
        .from('usuarios')
        .select('rol')
        .eq('id', user.id)
        .single()

      const dest = usuario?.rol === 'empleado' ? '/panel' : '/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    return supabaseResponse
  }

  // No user → redirect to login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Get user role
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('rol, activo')
    .eq('id', user.id)
    .single()

  if (!usuario || !usuario.activo) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Admin routes — block employees
  const adminRoutes = [
    '/dashboard', '/importar', '/productos', '/gastos',
    '/stock', '/equipo', '/usuarios', '/cadetes', '/laboratorio', '/configuracion',
    '/clientes', '/consumo-interno', '/auditoria', '/evolucion'
  ]
  if (adminRoutes.some(r => path.startsWith(r)) && usuario.rol !== 'admin') {
    return NextResponse.redirect(new URL('/panel', request.url))
  }

  // Employee routes — block admin (optional, admin can see everything)
  if (path.startsWith('/panel') && usuario.rol === 'admin') {
    // Admin can also access employee panel if needed
    return supabaseResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
