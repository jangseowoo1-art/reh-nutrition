import { Hono } from 'hono'

// ════════════════════════════════════════════════════════════════
//  이벤트(행사성) 비용 라우트
//  ----------------------------------------------------------------
//  - 데이터: event_expenses 테이블 (migrations/0067)
//  - 패턴: card_expenses.ts 와 동일 (저장 시 daily_orders 합계 동기화)
//  - cost_type 은 event_expenses 에 별도 컬럼이 없으나, 이 테이블의 모든
//    행은 정의상 '이벤트(event)' 운영비이므로 별도 분류 불필요.
//  - daily_orders 동기화: (병원·이벤트버튼업체·날짜) 합계를 upsert →
//    기존 대시보드/KPI 계산이 이벤트 금액을 자동 인식.
// ════════════════════════════════════════════════════════════════

const eventExpenses = new Hono<{ Bindings: { DB: D1Database } }>()

// admin / hq 는 query hospitalId, 일반 사용자는 user.hospitalId
function getHospId(user: any, c: any): number {
  if (user.role === 'admin' || user.role === 'hq') {
    const qId = c.req.query('hospitalId')
    return qId ? Number(qId) : Number(user.hospitalId)
  }
  return Number(user.hospitalId)
}

// ── (병원·업체·날짜) 이벤트 합계를 daily_orders 에 동기화 ──────────
//    card_expenses.ts 와 동일한 안전 패턴:
//    합계 0 → 기존 행 삭제 / 합계 > 0 → upsert (patient_category_id IS NULL 행)
async function syncDailyOrder(
  DB: D1Database, hospitalId: number, vendorId: number, date: string
): Promise<number> {
  const total = await DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM event_expenses
    WHERE hospital_id = ? AND vendor_id = ? AND expense_date = ?
  `).bind(hospitalId, vendorId, date).first<any>()
  const dayTotal = total?.total || 0

  const existing = await DB.prepare(`
    SELECT id FROM daily_orders
    WHERE hospital_id = ? AND vendor_id = ? AND order_date = ? AND patient_category_id IS NULL
  `).bind(hospitalId, vendorId, date).first<any>()

  if (dayTotal === 0) {
    if (existing) {
      await DB.prepare(`DELETE FROM daily_orders WHERE id = ?`).bind(existing.id).run()
    }
  } else if (existing) {
    await DB.prepare(`
      UPDATE daily_orders SET
        taxable_amount=0, exempt_amount=0, vat_amount=0, total_amount=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(dayTotal, existing.id).run()
  } else {
    await DB.prepare(`
      INSERT INTO daily_orders
        (hospital_id, vendor_id, order_date, taxable_amount, exempt_amount, vat_amount, total_amount)
      VALUES (?, ?, ?, 0, 0, 0, ?)
    `).bind(hospitalId, vendorId, date, dayTotal).run()
  }
  return dayTotal
}

// ── 월별 집계 빌더 (monthly / admin 공통) ────────────────────────
async function buildMonthly(DB: D1Database, hospitalId: number, year: string, month: string) {
  const mm = String(month).padStart(2, '0')
  const prefix = `${year}-${mm}`

  // 이 달의 지출 내역 전체 (실제 구매 업체명 조인)
  const expenses = await DB.prepare(`
    SELECT ee.*,
           COALESCE(rv.name, ee.vendor_name) AS vendor_display_name,
           v.name AS event_vendor_name
    FROM event_expenses ee
    LEFT JOIN vendors rv ON ee.row_vendor_id = rv.id AND rv.id > 0
    LEFT JOIN vendors v  ON ee.vendor_id = v.id AND v.id > 0
    WHERE ee.hospital_id = ? AND ee.expense_date LIKE ?
    ORDER BY ee.expense_date DESC, ee.id DESC
  `).bind(hospitalId, `${prefix}%`).all<any>()

  // 이벤트 버튼 업체 목록 (category='event')
  const eventVendors = await DB.prepare(`
    SELECT id, name, category, monthly_budget, sort_order
    FROM vendors
    WHERE hospital_id = ? AND is_active = 1 AND category = 'event'
    ORDER BY sort_order
  `).bind(hospitalId).all<any>()

  // 품목별 합계
  const itemSummary = await DB.prepare(`
    SELECT item_name, COUNT(*) as count, COALESCE(SUM(amount),0) as total
    FROM event_expenses
    WHERE hospital_id = ? AND expense_date LIKE ?
    GROUP BY item_name
    ORDER BY total DESC
  `).bind(hospitalId, `${prefix}%`).all<any>()

  // 용도별 합계 (purpose NULL → '기타')
  const purposeSummary = await DB.prepare(`
    SELECT COALESCE(NULLIF(purpose,''), '기타') as purpose, COUNT(*) as count, COALESCE(SUM(amount),0) as total
    FROM event_expenses
    WHERE hospital_id = ? AND expense_date LIKE ?
    GROUP BY COALESCE(NULLIF(purpose,''), '기타')
    ORDER BY total DESC
  `).bind(hospitalId, `${prefix}%`).all<any>()

  // 실제 구매 업체별 합계 (row_vendor_id 기준)
  const rowVendorTotals = await DB.prepare(`
    SELECT ee.row_vendor_id,
           COALESCE(rv.name, ee.vendor_name) AS vendor_name,
           COUNT(*) as count, COALESCE(SUM(ee.amount),0) as total
    FROM event_expenses ee
    LEFT JOIN vendors rv ON ee.row_vendor_id = rv.id AND rv.id > 0
    WHERE ee.hospital_id = ? AND ee.expense_date LIKE ?
    GROUP BY ee.row_vendor_id, COALESCE(rv.name, ee.vendor_name)
    ORDER BY total DESC
  `).bind(hospitalId, `${prefix}%`).all<any>()

  // 이벤트 버튼 업체별 일별 합계 (발주 화면 버튼 표시용)
  const dailyTotals = await DB.prepare(`
    SELECT vendor_id, expense_date, COALESCE(SUM(amount),0) as daily_total, COUNT(*) as item_count
    FROM event_expenses
    WHERE hospital_id = ? AND expense_date LIKE ?
    GROUP BY vendor_id, expense_date
  `).bind(hospitalId, `${prefix}%`).all<any>()

  const monthTotal = (expenses.results || []).reduce((s: number, e: any) => s + (e.amount || 0), 0)

  return {
    expenses: expenses.results || [],
    eventVendors: eventVendors.results || [],
    itemSummary: itemSummary.results || [],
    purposeSummary: purposeSummary.results || [],
    rowVendorTotals: rowVendorTotals.results || [],
    dailyTotals: dailyTotals.results || [],
    monthTotal
  }
}

// ── 드롭다운용 전체 업체 목록 ────────────────────────────────────
//    (실제 구매 업체 선택용 — 모든 활성 업체)
eventExpenses.get('/vendors', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const rows = await c.env.DB.prepare(`
    SELECT id, name, category, sort_order
    FROM vendors
    WHERE hospital_id = ? AND is_active = 1
    ORDER BY category, sort_order, name
  `).bind(hospitalId).all<any>()
  return c.json({ vendors: rows.results || [] })
})

// ── 특정 날짜+이벤트버튼업체 지출내역 조회 ───────────────────────
eventExpenses.get('/daily/:vendorId/:date', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const { vendorId, date } = c.req.param()

  const rows = await c.env.DB.prepare(`
    SELECT ee.*,
           COALESCE(rv.name, ee.vendor_name) AS vendor_display_name
    FROM event_expenses ee
    LEFT JOIN vendors rv ON ee.row_vendor_id = rv.id AND rv.id > 0
    WHERE ee.hospital_id = ? AND ee.vendor_id = ? AND ee.expense_date = ?
    ORDER BY ee.id ASC
  `).bind(hospitalId, vendorId, date).all<any>()

  const total = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM event_expenses
    WHERE hospital_id = ? AND vendor_id = ? AND expense_date = ?
  `).bind(hospitalId, vendorId, date).first<any>()

  return c.json({
    items: rows.results || [],
    total: total?.total || 0,
    count: total?.count || 0
  })
})

// ── 이벤트 지출 저장 (upsert batch) ──────────────────────────────
//    body: { vendorId, date, items:[{id?, rowVendorId, vendorName, itemName, amount, memo}], deletedIds:[] }
eventExpenses.post('/save', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const body = await c.req.json()
  const { vendorId, date, items, deletedIds = [] } = body

  if (!vendorId || !date || !Array.isArray(items)) {
    return c.json({ error: 'invalid params' }, 400)
  }

  // deletedIds 삭제 (병원 격리)
  if (deletedIds && deletedIds.length > 0) {
    for (const did of deletedIds) {
      await c.env.DB.prepare(
        `DELETE FROM event_expenses WHERE id = ? AND hospital_id = ?`
      ).bind(did, hospitalId).run()
    }
  }

  const savedIds: number[] = []
  for (const item of items) {
    const amt = Number(item.amount) || 0
    if (!amt || !item.itemName) continue
    const rowVendorId = item.rowVendorId || null
    const purpose = item.purpose ?? null
    if (item.id) {
      // 업데이트
      await c.env.DB.prepare(`
        UPDATE event_expenses SET
          row_vendor_id=?, vendor_name=?, item_name=?, purpose=?, amount=?, memo=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE id = ? AND hospital_id = ?
      `).bind(
        rowVendorId, item.vendorName || '', item.itemName, purpose,
        amt, item.memo || null,
        item.id, hospitalId
      ).run()
      savedIds.push(item.id)
    } else {
      // 신규 삽입
      const r = await c.env.DB.prepare(`
        INSERT INTO event_expenses
          (hospital_id, vendor_id, expense_date, vendor_name, item_name, purpose, amount, memo, row_vendor_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        hospitalId, vendorId, date,
        item.vendorName || '', item.itemName, purpose,
        amt, item.memo || null, rowVendorId
      ).run()
      if (r.meta?.last_row_id) savedIds.push(r.meta.last_row_id as number)
    }
  }

  // daily_orders 합계 동기화
  const dayTotal = await syncDailyOrder(c.env.DB, hospitalId, Number(vendorId), date)

  // 서버 기준 실제 건수
  const cnt = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM event_expenses
    WHERE hospital_id = ? AND vendor_id = ? AND expense_date = ?
  `).bind(hospitalId, vendorId, date).first<any>()

  return c.json({ success: true, savedIds, dayTotal, itemCount: cnt?.count || 0 })
})

// ── 월별 이벤트 지출 (영양사 본인 병원) ──────────────────────────
eventExpenses.get('/monthly/:year/:month', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const { year, month } = c.req.param()
  const data = await buildMonthly(c.env.DB, hospitalId, year, month)
  return c.json(data)
})

// ── 관리자: 특정 병원 월별 이벤트 지출 ───────────────────────────
eventExpenses.get('/admin/:hospitalId/:year/:month', async (c) => {
  const { hospitalId, year, month } = c.req.param()
  const data = await buildMonthly(c.env.DB, Number(hospitalId), year, month)
  return c.json(data)
})

// ── 지출 단건 삭제 ───────────────────────────────────────────────
eventExpenses.delete('/:id', async (c) => {
  const user = c.get('user')
  const hospitalId = getHospId(user, c)
  const { id } = c.req.param()

  // 삭제 전 vendor_id, date 조회 (daily_orders 재계산용)
  const row = await c.env.DB.prepare(
    `SELECT vendor_id, expense_date FROM event_expenses WHERE id = ? AND hospital_id = ?`
  ).bind(id, hospitalId).first<any>()

  if (!row) return c.json({ error: 'not found' }, 404)

  await c.env.DB.prepare(
    `DELETE FROM event_expenses WHERE id = ? AND hospital_id = ?`
  ).bind(id, hospitalId).run()

  const dayTotal = await syncDailyOrder(c.env.DB, hospitalId, Number(row.vendor_id), row.expense_date)

  return c.json({ success: true, dayTotal })
})

export default eventExpenses
