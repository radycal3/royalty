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
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
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

  // --- DEBUG LOGS (remover antes de producción) ---

  // Ruta pública: /login
  if (path === '/login') {
    if (user) {
      const { data: usuario, error: usuarioError } = await supabase
        .from('usuarios')
        .select('rol')
        .eq('id', user.id)
        .single()

    
      const dest = usuario?.rol === 'empleado' ? '/panel' : '/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    return supabaseResponse
  }

  // Sin sesión → login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Obtener rol
  const { data: usuario, error: usuarioError } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single()

  console.log('TABLA USUARIOS:', usuario)
  console.log('ERROR USUARIOS:', usuarioError)
  // --- FIN DEBUG LOGS ---

  if (!usuario) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Rutas admin — bloquear empleados
  const adminRoutes = [
    '/dashboard', '/importar', '/productos', '/gastos',
    '/stock', '/equipo', '/cadetes', '/laboratorio', '/configuracion'
  ]
  if (adminRoutes.some(r => path.startsWith(r)) && usuario.rol !== 'admin') {
    return NextResponse.redirect(new URL('/panel', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
