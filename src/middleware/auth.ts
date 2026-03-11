import { Context, Next } from 'hono'
import { verifyToken } from '../utils/auth'

const JWT_SECRET = 'hospital-meal-budget-secret-2025'

export async function authMiddleware(c: Context, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || 
                getCookie(c.req.raw, 'token')
  
  if (!token) {
    return c.redirect('/login')
  }
  
  const payload = await verifyToken(token, JWT_SECRET)
  if (!payload) {
    return c.redirect('/login')
  }
  
  c.set('user', payload)
  await next()
}

export async function adminMiddleware(c: Context, next: Next) {
  const user = c.get('user')
  if (!user || user.role !== 'admin') {
    return c.json({ error: '관리자 권한이 필요합니다' }, 403)
  }
  await next()
}

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie')
  if (!cookies) return null
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export { JWT_SECRET }
