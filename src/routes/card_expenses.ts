import { Hono } from 'hono'

const cardExpenses = new Hono<{ Bindings: { DB: D1Database } }>()

// ── 월별 법인카드 지출내역 조회 ──────────────────────────────────
cardExpenses.get('/monthly/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { year, month } = c.req.param()
  const mm = month.padStart(2, '0')
  const prefix = `${year}-${mm}`

  // 법인카드 업체 목록
  const cardVendors = await c.env.DB.prepare(`
    SELECT id, name, category, is_card_type, card_subtype, monthly_budget
    FROM vendors
    WHERE hospital_id = ? AND is_active = 1 AND is_card_type = 1
    ORDER BY sort_order
  `).bind(hospitalId).all<any>()

  // 이 달의 지출 내역 전체
  const expenses = await c.env.DB.prepare(`
    SELECT ce.*, v.name as vendor_display_name, v.card_subtype
    FROM card_expenses ce
    JOIN vendors v ON ce.vendor_id = v.id
    WHERE ce.hospital_id = ? AND ce.expense_date LIKE ?
    ORDER BY ce.expense_date DESC, ce.id DESC
  `).bind(hospitalId, `${prefix}%`).all<any>()

  // 업체별 월 합계
  const vendorTotals = await c.env.DB.prepare(`
    SELECT vendor_id, SUM(amount) as total
    FROM card_expenses
    WHERE hospital_id = ? AND expense_date LIKE ?
    GROUP BY vendor_id
  `).bind(hospitalId, `${prefix}%`).all<any>()

  // 일별 합계 (발주 화면 표시용)
  const dailyTotals = await c.env.DB.prepare(`
    SELECT vendor_id, expense_date, SUM(amount) as daily_total, COUNT(*) as item_count
    FROM card_expenses
    WHERE hospital_id = ? AND expense_date LIKE ?
    GROUP BY vendor_id, expense_date
  `).bind(hospitalId, `${prefix}%`).all<any>()

  return c.json({
    cardVendors: cardVendors.results || [],
    expenses: expenses.results || [],
    vendorTotals: vendorTotals.results || [],
    dailyTotals: dailyTotals.results || []
  })
})

// ── 특정 날짜+업체 지출내역 조회 ────────────────────────────────
cardExpenses.get('/daily/:vendorId/:date', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { vendorId, date } = c.req.param()

  const rows = await c.env.DB.prepare(`
    SELECT * FROM card_expenses
    WHERE hospital_id = ? AND vendor_id = ? AND expense_date = ?
    ORDER BY id ASC
  `).bind(hospitalId, vendorId, date).all<any>()

  const total = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM card_expenses
    WHERE hospital_id = ? AND vendor_id = ? AND expense_date = ?
  `).bind(hospitalId, vendorId, date).first<any>()

  return c.json({
    items: rows.results || [],
    total: total?.total || 0,
    count: total?.count || 0
  })
})

// ── 법인카드 지출 저장 (upsert batch) ────────────────────────────
// items: [{id?, vendorName, itemName, purpose, amount, memo}]
cardExpenses.post('/save', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const body = await c.req.json()
  const { vendorId, date, items, deletedIds = [] } = body

  if (!vendorId || !date || !Array.isArray(items)) {
    return c.json({ error: 'invalid params' }, 400)
  }

  // deletedIds 삭제
  if (deletedIds && deletedIds.length > 0) {
    for (const did of deletedIds) {
      await c.env.DB.prepare(
        `DELETE FROM card_expenses WHERE id = ? AND hospital_id = ?`
      ).bind(did, hospitalId).run()
    }
  }

  const savedIds: number[] = []
  for (const item of items) {
    if (!item.amount || !item.itemName || !item.vendorName || !item.purpose) continue
    if (item.id) {
      // 업데이트
      await c.env.DB.prepare(`
        UPDATE card_expenses SET
          vendor_name=?, item_name=?, purpose=?, amount=?, memo=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE id = ? AND hospital_id = ?
      `).bind(
        item.vendorName, item.itemName, item.purpose,
        item.amount, item.memo || null,
        item.id, hospitalId
      ).run()
      savedIds.push(item.id)
    } else {
      // 신규 삽입
      const r = await c.env.DB.prepare(`
        INSERT INTO card_expenses
          (hospital_id, vendor_id, expense_date, vendor_name, item_name, purpose, amount, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        hospitalId, vendorId, date,
        item.vendorName, item.itemName, item.purpose,
        item.amount, item.memo || null
      ).run()
      if (r.meta?.last_row_id) savedIds.push(r.meta.last_row_id as number)
    }
  }

  // 이 날짜+업체의 daily_orders 합계 자동 동기화
  const total = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM card_expenses
    WHERE hospital_id = ? AND vendor_id = ? AND expense_date = ?
  `).bind(hospitalId, vendorId, date).first<any>()
  const dayTotal = total?.total || 0

  // daily_orders에 합계 upsert (법인카드는 exempt_amount=0, taxable=0, total=합계)
  const existing = await c.env.DB.prepare(`
    SELECT id FROM daily_orders
    WHERE hospital_id = ? AND vendor_id = ? AND order_date = ? AND patient_category_id IS NULL
  `).bind(hospitalId, vendorId, date).first<any>()

  if (dayTotal === 0) {
    if (existing) {
      await c.env.DB.prepare(`DELETE FROM daily_orders WHERE id = ?`).bind(existing.id).run()
    }
  } else if (existing) {
    await c.env.DB.prepare(`
      UPDATE daily_orders SET
        taxable_amount=0, exempt_amount=0, vat_amount=0, total_amount=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(dayTotal, existing.id).run()
  } else {
    await c.env.DB.prepare(`
      INSERT INTO daily_orders
        (hospital_id, vendor_id, order_date, taxable_amount, exempt_amount, vat_amount, total_amount)
      VALUES (?, ?, ?, 0, 0, 0, ?)
    `).bind(hospitalId, vendorId, date, dayTotal).run()
  }

  return c.json({ success: true, savedIds, dayTotal })
})

// ── 지출 단건 삭제 ────────────────────────────────────────────
cardExpenses.delete('/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = Number(user.hospitalId)
  const { id } = c.req.param()

  // 삭제 전 vendor_id, date 조회
  const row = await c.env.DB.prepare(
    `SELECT vendor_id, expense_date FROM card_expenses WHERE id = ? AND hospital_id = ?`
  ).bind(id, hospitalId).first<any>()

  if (!row) return c.json({ error: 'not found' }, 404)

  await c.env.DB.prepare(
    `DELETE FROM card_expenses WHERE id = ? AND hospital_id = ?`
  ).bind(id, hospitalId).run()

  // daily_orders 합계 재계산
  const total = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM card_expenses
    WHERE hospital_id = ? AND vendor_id = ? AND expense_date = ?
  `).bind(hospitalId, row.vendor_id, row.expense_date).first<any>()
  const dayTotal = total?.total || 0

  const existing = await c.env.DB.prepare(`
    SELECT id FROM daily_orders
    WHERE hospital_id = ? AND vendor_id = ? AND order_date = ? AND patient_category_id IS NULL
  `).bind(hospitalId, row.vendor_id, row.expense_date).first<any>()

  if (dayTotal === 0) {
    if (existing) await c.env.DB.prepare(`DELETE FROM daily_orders WHERE id = ?`).bind(existing.id).run()
  } else if (existing) {
    await c.env.DB.prepare(`
      UPDATE daily_orders SET total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(dayTotal, existing.id).run()
  }

  return c.json({ success: true, dayTotal })
})

// ── 관리자: 특정 병원의 월별 법인카드 내역 ──────────────────────
cardExpenses.get('/admin/:hospitalId/:year/:month', async (c) => {
  const { hospitalId, year, month } = c.req.param()
  const mm = month.padStart(2, '0')
  const prefix = `${year}-${mm}`

  const expenses = await c.env.DB.prepare(`
    SELECT ce.*, v.name as card_vendor_name, v.card_subtype
    FROM card_expenses ce
    JOIN vendors v ON ce.vendor_id = v.id
    WHERE ce.hospital_id = ? AND ce.expense_date LIKE ?
    ORDER BY ce.expense_date, ce.vendor_id, ce.id
  `).bind(hospitalId, `${prefix}%`).all<any>()

  return c.json({ expenses: expenses.results || [] })
})

export default cardExpenses
