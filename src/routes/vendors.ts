import { Hono } from 'hono'

const vendors = new Hono<{ Bindings: { DB: D1Database } }>()

// admin은 query hospitalId, 일반 사용자는 user.hospitalId
function getHospId(user: any, c: any): number {
  if (user.role === 'admin' || user.role === 'hq') {
    const qId = c.req.query('hospitalId')
    return qId ? Number(qId) : Number(user.hospitalId)
  }
  return Number(user.hospitalId)
}

// 병원 업체 목록
vendors.get('/', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const data = await c.env.DB.prepare(
    `SELECT * FROM vendors WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order`
  ).bind(hospitalId).all<any>()
  return c.json(data.results)
})

// 업체 추가
vendors.post('/', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { name, category, taxType, monthlyBudget, sortOrder, isCardType, cardSubtype, orderCycle } = await c.req.json()

  await c.env.DB.prepare(
    `INSERT INTO vendors (hospital_id, name, category, tax_type, monthly_budget, sort_order, is_card_type, card_subtype, order_cycle)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    hospitalId, name, category || 'general', taxType || 'mixed',
    monthlyBudget || 0, sortOrder || 99,
    isCardType ? 1 : 0, cardSubtype || null,
    orderCycle || 'daily'
  ).run()

  return c.json({ success: true })
})

// 업체 수정
vendors.put('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const { name, category, taxType, monthlyBudget, sortOrder, isCardType, cardSubtype, orderCycle } = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE vendors SET name=?, category=?, tax_type=?, monthly_budget=?, sort_order=?,
     is_card_type=?, card_subtype=?, order_cycle=?
     WHERE id = ? AND hospital_id = ?`
  ).bind(
    name, category, taxType, monthlyBudget || 0, sortOrder || 99,
    isCardType ? 1 : 0, cardSubtype || null,
    orderCycle || 'daily',
    id, user.hospitalId
  ).run()

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
