import { Hono } from 'hono'

const schedule = new Hono<{ Bindings: { DB: D1Database } }>()

// 직원 목록 조회
schedule.get('/employees', async (c) => {
  const user = c.get('user')
  const data = await c.env.DB.prepare(
    `SELECT * FROM employees WHERE hospital_id = ? AND is_active = 1 ORDER BY sort_order, id`
  ).bind(user.hospitalId).all<any>()
  return c.json(data.results)
})

// 직원 추가
schedule.post('/employees', async (c) => {
  const user = c.get('user')
  const { name, position, section, phone, annualLeaveTotal, sortOrder } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO employees (hospital_id, name, position, section, phone, annual_leave_total, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.hospitalId, name, position || '', section || 'cook', phone || null, annualLeaveTotal || 15, sortOrder || 99).run()
  return c.json({ success: true })
})

// 직원 수정
schedule.put('/employees/:id', async (c) => {
  const user = c.get('user')
  const { name, position, section, phone, annualLeaveTotal } = await c.req.json()
  await c.env.DB.prepare(
    `UPDATE employees SET name=?, position=?, section=?, phone=?, annual_leave_total=?
     WHERE id=? AND hospital_id=?`
  ).bind(name, position, section, phone||null, annualLeaveTotal||15, c.req.param('id'), user.hospitalId).run()
  return c.json({ success: true })
})

// 직원 비활성화
schedule.delete('/employees/:id', async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(
    `UPDATE employees SET is_active=0 WHERE id=? AND hospital_id=?`
  ).bind(c.req.param('id'), user.hospitalId).run()
  return c.json({ success: true })
})

// 월별 스케줄 조회
schedule.get('/:year/:month', async (c) => {
  const user = c.get('user')
  const { year, month } = c.req.param()
  const data = await c.env.DB.prepare(
    `SELECT s.*, e.name as employee_name, e.position
     FROM daily_schedules s
     JOIN employees e ON s.employee_id = e.id
     WHERE s.hospital_id = ?
       AND strftime('%Y', s.work_date) = ?
       AND strftime('%m', s.work_date) = printf('%02d', ?)
     ORDER BY e.sort_order, s.work_date`
  ).bind(user.hospitalId, year, month).all<any>()
  return c.json(data.results)
})

// 스케줄 저장 (upsert)
schedule.post('/save', async (c) => {
  const user = c.get('user')
  const { employeeId, workDate, shiftCode, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO daily_schedules (hospital_id, employee_id, work_date, shift_code, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hospital_id, employee_id, work_date) DO UPDATE SET
     shift_code = excluded.shift_code,
     note = excluded.note,
     updated_at = CURRENT_TIMESTAMP`
  ).bind(user.hospitalId, employeeId, workDate, shiftCode, note || null).run()
  return c.json({ success: true })
})

// 스케줄 삭제
schedule.delete('/:employeeId/:workDate', async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(
    `DELETE FROM daily_schedules WHERE hospital_id=? AND employee_id=? AND work_date=?`
  ).bind(user.hospitalId, c.req.param('employeeId'), c.req.param('workDate')).run()
  return c.json({ success: true })
})

export default schedule
