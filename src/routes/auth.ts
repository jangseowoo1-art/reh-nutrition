import { Hono } from 'hono'
import { hashPassword, createToken } from '../utils/auth'
import { JWT_SECRET } from '../middleware/auth'

const auth = new Hono<{ Bindings: { DB: D1Database } }>()

// 로그인
auth.post('/login', async (c) => {
  const { username, password } = await c.req.json()
  if (!username || !password) {
    return c.json({ error: '아이디와 비밀번호를 입력해주세요' }, 400)
  }

  const passwordHash = await hashPassword(password)
  
  const user = await c.env.DB.prepare(
    `SELECT u.*, h.name as hospital_name, h.code as hospital_code 
     FROM users u 
     LEFT JOIN hospitals h ON u.hospital_id = h.id 
     WHERE u.username = ? AND u.password_hash = ?`
  ).bind(username, passwordHash).first<any>()

  if (!user) {
    return c.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' }, 401)
  }

  const token = await createToken({
    userId: user.id,
    hospitalId: user.hospital_id,
    hospitalName: user.hospital_name,
    hospitalCode: user.hospital_code,
    role: user.role,
    username: user.username
  }, JWT_SECRET)

  return c.json({ 
    token, 
    role: user.role,
    hospitalName: user.hospital_name,
    username: user.username
  })
})

export default auth
