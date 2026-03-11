import { Hono } from 'hono'

const vendors = new Hono<{ Bindings: { DB: D1Database } }>()

// 병원 업체 목록
vendors.get('/', async (c) => {
  const user = c.get('user')
  const hospitalId = user.hospitalId
  const data = await c.env.DB.prepare(
    `SELECT * FROM vendors WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order`
  ).bind(hospitalId).all<any>()
  return c.json(data.results)
})

// 업체 추가
vendors.post('/', async (c) => {
  const user = c.get('user')
  const hospitalId = user.hospitalId
  const { name, category, taxType, monthlyBudget, sortOrder } = await c.req.json()
  
  await c.env.DB.prepare(
    `INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(hospitalId, name, category || 'general', taxType || 'mixed', monthlyBudget || 0, sortOrder || 99).run()
  
  return c.json({ success: true })
})

// 업체 수정
vendors.put('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const { name, category, taxType, monthlyBudget, sortOrder } = await c.req.json()
  
  await c.env.DB.prepare(
    `UPDATE vendors SET name=?, category=?, tax_type=?, monthly_budget=?, sort_order=?
     WHERE id = ? AND hospital_id = ?`
  ).bind(name, category, taxType, monthlyBudget || 0, sortOrder || 99, id, user.hospitalId).run()
  
  return c.json({ success: true })
})

// 업체 삭제(비활성화)
vendors.delete('/:id', async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(
    `UPDATE vendors SET is_active = 0 WHERE id = ? AND hospital_id = ?`
  ).bind(c.req.param('id'), user.hospitalId).run()
  return c.json({ success: true })
})

export default vendors
