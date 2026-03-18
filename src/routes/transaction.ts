import { Hono } from 'hono'

const txRouter = new Hono<{ Bindings: { DB: D1Database } }>()

// ══════════════════════════════════════════════════════════════
// 거래명세서 분석 시스템 API Routes
// ── 구조: 파일업로드 → 파싱 → 미리보기/수정 → AI분석 → 보고서연동
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// [카테고리] 품목 카테고리 목록 조회
// ─────────────────────────────────────────────
txRouter.get('/categories', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM transaction_item_categories WHERE is_active=1 ORDER BY sort_order`
    ).all<any>()
    return c.json({ ok: true, data: rows.results })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [파일] 업로드된 파일 목록 조회
// ─────────────────────────────────────────────
txRouter.get('/files', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const year  = c.req.query('year')
    const month = c.req.query('month')

    let sql = `SELECT tf.*, h.name as hospital_name
               FROM transaction_files tf
               LEFT JOIN hospitals h ON tf.hospital_id = h.id
               WHERE tf.hospital_id = ?`
    const params: any[] = [hospitalId]
    if (year)  { sql += ` AND tf.document_year=?`;  params.push(year) }
    if (month) { sql += ` AND tf.document_month=?`; params.push(month) }
    sql += ` ORDER BY tf.created_at DESC LIMIT 100`

    const rows = await c.env.DB.prepare(sql).bind(...params).all<any>()
    return c.json({ ok: true, data: rows.results })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [파일] 거래명세서 파일 업로드 + 파싱 (XLSX / 텍스트 PDF)
// ─────────────────────────────────────────────
txRouter.post('/upload', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)

    const body = await c.req.json()
    const {
      file_name, file_type, file_size,
      file_data,          // Base64 데이터 (클라이언트에서 파싱 후 전송)
      vendor_name, document_year, document_month,
      parsed_rows         // 클라이언트 파싱 결과 [{item_name,qty,unit,unit_price,amount,tax_type,raw}]
    } = body

    if (!file_name || !file_type) {
      return c.json({ ok: false, error: '파일명과 파일 형식은 필수입니다.' }, 400)
    }
    if (!document_year || !document_month) {
      return c.json({ ok: false, error: '명세서 연도와 월을 입력해주세요.' }, 400)
    }

    // 1) 파일 레코드 생성
    const fileResult = await c.env.DB.prepare(`
      INSERT INTO transaction_files
        (hospital_id, file_name, file_type, file_size, vendor_name,
         document_year, document_month, parse_status, row_count, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,'processing',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `).bind(
      hospitalId, file_name, file_type, file_size || 0, vendor_name || '',
      document_year, document_month
    ).run()

    const fileId = fileResult.meta.last_row_id

    if (!parsed_rows || parsed_rows.length === 0) {
      await c.env.DB.prepare(
        `UPDATE transaction_files SET parse_status='failed', parse_error='파싱 데이터 없음' WHERE id=?`
      ).bind(fileId).run()
      return c.json({ ok: false, error: '파싱된 데이터가 없습니다.' }, 400)
    }

    // 2) 문서 레코드 생성
    const totalAmount    = parsed_rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0)
    const taxableAmount  = parsed_rows.filter((r: any) => r.tax_type !== 'nontaxable')
                                      .reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0)
    const taxAmt         = Math.round(taxableAmount * 0.1)
    const nontaxableAmt  = totalAmount - taxableAmount

    const docResult = await c.env.DB.prepare(`
      INSERT INTO transaction_documents
        (file_id, hospital_id, vendor_name, document_date, document_year, document_month,
         total_amount, taxable_amount, tax_amount, nontaxable_amount, item_count, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `).bind(
      fileId, hospitalId, vendor_name || '',
      `${document_year}-${String(document_month).padStart(2,'0')}-01`,
      document_year, document_month,
      totalAmount, taxableAmount, taxAmt, nontaxableAmt, parsed_rows.length
    ).run()

    const docId = docResult.meta.last_row_id

    // 3) 품목 카테고리 목록 로드 (자동 분류용)
    const categories = await c.env.DB.prepare(
      `SELECT id, name, code FROM transaction_item_categories WHERE is_active=1`
    ).all<any>()
    const catMap = buildCategoryMap(categories.results)

    // 4) 품목 개별 INSERT (batch)
    let insertCount = 0
    for (const row of parsed_rows) {
      const itemName = String(row.item_name || '').trim()
      if (!itemName) continue

      const qty        = Number(row.quantity ?? row.qty ?? 0)
      const unitPrice  = Number(row.unit_price ?? 0)
      const amount     = Number(row.amount ?? 0) || Math.round(qty * unitPrice)
      const taxType    = normalizeTaxType(row.tax_type)
      const normalized = normalizeItemName(itemName)
      const catId      = guessCategoryId(normalized, catMap)

      await c.env.DB.prepare(`
        INSERT INTO transaction_items
          (document_id, file_id, hospital_id, vendor_name,
           document_year, document_month,
           item_name, item_name_normalized, category_id,
           quantity, unit, unit_price, amount, tax_type, tax_amount,
           raw_row, is_verified, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP)
      `).bind(
        docId, fileId, hospitalId, vendor_name || '',
        document_year, document_month,
        itemName, normalized, catId,
        qty, row.unit || '', unitPrice, amount, taxType,
        taxType !== 'nontaxable' ? Math.round(amount / 11) : 0,
        JSON.stringify(row)
      ).run()
      insertCount++
    }

    // 5) 파일 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE transaction_files SET parse_status='completed', row_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(insertCount, fileId).run()

    return c.json({ ok: true, file_id: fileId, doc_id: docId, row_count: insertCount })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [품목] 파일의 파싱 품목 조회 (미리보기/수정)
// ─────────────────────────────────────────────
txRouter.get('/files/:fileId/items', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const fileId = c.req.param('fileId')

    const rows = await c.env.DB.prepare(`
      SELECT ti.*, tic.name as category_name, tic.color as category_color
      FROM transaction_items ti
      LEFT JOIN transaction_item_categories tic ON ti.category_id = tic.id
      WHERE ti.file_id=? AND ti.hospital_id=?
      ORDER BY ti.id
    `).bind(fileId, hospitalId).all<any>()

    return c.json({ ok: true, data: rows.results })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [품목] 단일 품목 수정 (검증 후 저장)
// ─────────────────────────────────────────────
txRouter.put('/items/:itemId', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const itemId = c.req.param('itemId')
    const { item_name, category_id, quantity, unit, unit_price, amount, tax_type, memo } = await c.req.json()

    const amt = amount || Math.round((quantity || 0) * (unit_price || 0))

    await c.env.DB.prepare(`
      UPDATE transaction_items SET
        item_name=?, item_name_normalized=?, category_id=?,
        quantity=?, unit=?, unit_price=?, amount=?, tax_type=?,
        tax_amount=?, memo=?, is_verified=1
      WHERE id=? AND hospital_id=?
    `).bind(
      item_name, normalizeItemName(item_name || ''), category_id || null,
      quantity || 0, unit || '', unit_price || 0, amt,
      normalizeTaxType(tax_type),
      tax_type !== 'nontaxable' ? Math.round(amt / 11) : 0,
      memo || '', itemId, hospitalId
    ).run()

    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [파일] 파일 삭제 (cascade → 문서/품목 함께 삭제)
// ─────────────────────────────────────────────
txRouter.delete('/files/:fileId', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const fileId = c.req.param('fileId')

    // cascade delete: items → documents → file
    await c.env.DB.prepare(`DELETE FROM transaction_items WHERE file_id=? AND hospital_id=?`)
      .bind(fileId, hospitalId).run()
    await c.env.DB.prepare(`DELETE FROM transaction_documents WHERE file_id=? AND hospital_id=?`)
      .bind(fileId, hospitalId).run()
    await c.env.DB.prepare(`DELETE FROM transaction_files WHERE id=? AND hospital_id=?`)
      .bind(fileId, hospitalId).run()

    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [분석] 월별 분석 데이터 조회
// ─────────────────────────────────────────────
txRouter.get('/analysis/monthly', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const year  = Number(c.req.query('year')  || new Date().getFullYear())
    const month = Number(c.req.query('month') || new Date().getMonth() + 1)

    // 1) 월 총계
    const totals = await c.env.DB.prepare(`
      SELECT
        SUM(amount)                                       AS total_amount,
        SUM(CASE WHEN tax_type='taxable'    THEN amount ELSE 0 END) AS taxable_amount,
        SUM(CASE WHEN tax_type='nontaxable' THEN amount ELSE 0 END) AS nontaxable_amount,
        SUM(CASE WHEN tax_type='exempt'     THEN amount ELSE 0 END) AS exempt_amount,
        COUNT(DISTINCT vendor_name)                       AS vendor_count,
        COUNT(*)                                          AS item_count
      FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
    `).bind(hospitalId, year, month).first<any>()

    // 2) 업체별 집계
    const byVendor = await c.env.DB.prepare(`
      SELECT vendor_name, SUM(amount) AS total, COUNT(*) AS cnt
      FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
      GROUP BY vendor_name ORDER BY total DESC LIMIT 10
    `).bind(hospitalId, year, month).all<any>()

    // 3) 카테고리별 집계
    const byCategory = await c.env.DB.prepare(`
      SELECT tic.name AS category_name, tic.color,
             SUM(ti.amount) AS total, COUNT(*) AS cnt
      FROM transaction_items ti
      LEFT JOIN transaction_item_categories tic ON ti.category_id = tic.id
      WHERE ti.hospital_id=? AND ti.document_year=? AND ti.document_month=?
      GROUP BY ti.category_id ORDER BY total DESC
    `).bind(hospitalId, year, month).all<any>()

    // 4) 상위 품목 TOP10
    const topItems = await c.env.DB.prepare(`
      SELECT item_name_normalized AS item_name, SUM(amount) AS total,
             SUM(quantity) AS total_qty, unit,
             AVG(unit_price) AS avg_price, vendor_name
      FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
      GROUP BY item_name_normalized ORDER BY total DESC LIMIT 10
    `).bind(hospitalId, year, month).all<any>()

    // 5) 전월 데이터 (비교용)
    const prevYear  = month === 1 ? year - 1 : year
    const prevMonth = month === 1 ? 12 : month - 1
    const prevTotals = await c.env.DB.prepare(`
      SELECT SUM(amount) AS total_amount FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
    `).bind(hospitalId, prevYear, prevMonth).first<any>()

    // 6) AI 알림 생성 (규칙 기반)
    const alerts = await generateAlerts(c.env.DB, hospitalId, year, month, prevYear, prevMonth)

    // 7) 월별 트렌드 (최근 6개월)
    const trend = await c.env.DB.prepare(`
      SELECT document_year AS y, document_month AS m,
             SUM(amount) AS total
      FROM transaction_items
      WHERE hospital_id=?
        AND (document_year*100 + document_month) BETWEEN ? AND ?
      GROUP BY document_year, document_month
      ORDER BY document_year, document_month
    `).bind(
      hospitalId,
      getPrevYearMonth(year, month, 5),
      year * 100 + month
    ).all<any>()

    return c.json({
      ok: true,
      year, month,
      totals: totals || {},
      by_vendor: byVendor.results,
      by_category: byCategory.results,
      top_items: topItems.results,
      prev_total: prevTotals?.total_amount || 0,
      trend: trend.results,
      alerts
    })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [분석] 분기별 분석
// ─────────────────────────────────────────────
txRouter.get('/analysis/quarterly', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const year    = Number(c.req.query('year')    || new Date().getFullYear())
    const quarter = Number(c.req.query('quarter') || Math.ceil((new Date().getMonth() + 1) / 3))

    const startMonth = (quarter - 1) * 3 + 1
    const endMonth   = quarter * 3

    const monthly = await c.env.DB.prepare(`
      SELECT document_month AS month,
             SUM(amount) AS total,
             COUNT(DISTINCT vendor_name) AS vendor_count
      FROM transaction_items
      WHERE hospital_id=? AND document_year=?
        AND document_month BETWEEN ? AND ?
      GROUP BY document_month ORDER BY document_month
    `).bind(hospitalId, year, startMonth, endMonth).all<any>()

    const byCategory = await c.env.DB.prepare(`
      SELECT tic.name AS category_name, tic.color,
             SUM(ti.amount) AS total
      FROM transaction_items ti
      LEFT JOIN transaction_item_categories tic ON ti.category_id = tic.id
      WHERE ti.hospital_id=? AND ti.document_year=?
        AND ti.document_month BETWEEN ? AND ?
      GROUP BY ti.category_id ORDER BY total DESC
    `).bind(hospitalId, year, startMonth, endMonth).all<any>()

    const quarterTotal = await c.env.DB.prepare(`
      SELECT SUM(amount) AS total FROM transaction_items
      WHERE hospital_id=? AND document_year=?
        AND document_month BETWEEN ? AND ?
    `).bind(hospitalId, year, startMonth, endMonth).first<any>()

    return c.json({
      ok: true, year, quarter,
      start_month: startMonth, end_month: endMonth,
      quarterly_total: quarterTotal?.total || 0,
      monthly_breakdown: monthly.results,
      by_category: byCategory.results
    })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [발주 교차 분석] 발주 vs 명세서 차이 분석
// ─────────────────────────────────────────────
txRouter.get('/cross-analysis', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const year  = Number(c.req.query('year')  || new Date().getFullYear())
    const month = Number(c.req.query('month') || new Date().getMonth() + 1)

    const mm = String(month).padStart(2, '0')
    const dateStart = `${year}-${mm}-01`
    const dateEnd   = `${year}-${mm}-31`

    // 발주 데이터 (orders → daily_orders + order_items 조인)
    // 기존 orders 테이블 구조에 맞게 조회
    const orderData = await c.env.DB.prepare(`
      SELECT
        oi.item_name,
        v.name AS vendor_name,
        SUM(oi.quantity)   AS ordered_qty,
        AVG(oi.unit_price) AS ordered_unit_price,
        SUM(oi.amount)     AS ordered_amount
      FROM order_items oi
      JOIN daily_orders d ON oi.order_id = d.id
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.hospital_id=? AND d.order_date BETWEEN ? AND ?
      GROUP BY oi.item_name, v.name
    `).bind(hospitalId, dateStart, dateEnd).all<any>()

    // 명세서 데이터
    const invoiceData = await c.env.DB.prepare(`
      SELECT item_name_normalized AS item_name,
             vendor_name,
             SUM(quantity)   AS invoice_qty,
             AVG(unit_price) AS invoice_unit_price,
             SUM(amount)     AS invoice_amount
      FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
      GROUP BY item_name_normalized, vendor_name
    `).bind(hospitalId, year, month).all<any>()

    // 교차 비교 매핑
    const discrepancies = buildCrossAnalysis(orderData.results, invoiceData.results)

    const summary = {
      total_order_amount:   orderData.results.reduce((s: number, r: any) => s + (r.ordered_amount || 0), 0),
      total_invoice_amount: invoiceData.results.reduce((s: number, r: any) => s + (r.invoice_amount || 0), 0),
      matched_items:  discrepancies.filter(d => d.alert_level === 'normal').length,
      warning_items:  discrepancies.filter(d => d.alert_level === 'warning').length,
      critical_items: discrepancies.filter(d => d.alert_level === 'critical').length
    }

    return c.json({
      ok: true, year, month, summary,
      discrepancies: discrepancies.slice(0, 100)
    })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [분석] 가격 추이 (특정 품목)
// ─────────────────────────────────────────────
txRouter.get('/price-trend', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const itemName = c.req.query('item_name') || ''

    if (!itemName) return c.json({ ok: false, error: '품목명을 입력해주세요.' }, 400)

    const rows = await c.env.DB.prepare(`
      SELECT document_year AS y, document_month AS m,
             AVG(unit_price) AS avg_price, SUM(amount) AS total_amount,
             SUM(quantity) AS total_qty, vendor_name
      FROM transaction_items
      WHERE hospital_id=? AND item_name_normalized LIKE ?
      GROUP BY document_year, document_month, vendor_name
      ORDER BY document_year, document_month
    `).bind(hospitalId, `%${itemName}%`).all<any>()

    return c.json({ ok: true, item_name: itemName, trend: rows.results })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [요약] 대시보드 통계 (최근 12개월)
// ─────────────────────────────────────────────
txRouter.get('/dashboard', async (c) => {
  try {
    const user = (c as any).get('user')
    const hospitalId = Number(user?.hospitalId || 0)
    const year  = Number(c.req.query('year')  || new Date().getFullYear())
    const month = Number(c.req.query('month') || new Date().getMonth() + 1)

    // 이번달 총 지출
    const thisMonth = await c.env.DB.prepare(`
      SELECT SUM(amount) AS total, COUNT(DISTINCT vendor_name) AS vendors,
             COUNT(DISTINCT file_id) AS files
      FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
    `).bind(hospitalId, year, month).first<any>()

    // 연간 월별 추이
    const annualTrend = await c.env.DB.prepare(`
      SELECT document_month AS month, SUM(amount) AS total
      FROM transaction_items
      WHERE hospital_id=? AND document_year=?
      GROUP BY document_month ORDER BY document_month
    `).bind(hospitalId, year).all<any>()

    // 전체 파일 수
    const fileStats = await c.env.DB.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN parse_status='completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN parse_status='failed'    THEN 1 ELSE 0 END) AS failed
      FROM transaction_files WHERE hospital_id=?
    `).bind(hospitalId).first<any>()

    // 상위 업체 TOP5
    const topVendors = await c.env.DB.prepare(`
      SELECT vendor_name, SUM(amount) AS total
      FROM transaction_items
      WHERE hospital_id=? AND document_year=?
      GROUP BY vendor_name ORDER BY total DESC LIMIT 5
    `).bind(hospitalId, year).all<any>()

    return c.json({
      ok: true,
      this_month: thisMonth || {},
      annual_trend: annualTrend.results,
      file_stats: fileStats || {},
      top_vendors: topVendors.results
    })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// 헬퍼 함수
// ══════════════════════════════════════════════════════════════

/** 세금 유형 정규화 */
function normalizeTaxType(raw: any): string {
  if (!raw) return 'taxable'
  const s = String(raw).toLowerCase().trim()
  if (s === '면세' || s === 'nontaxable' || s === 'non-taxable' || s === '0') return 'nontaxable'
  if (s === '영세' || s === 'exempt' || s === '영') return 'exempt'
  return 'taxable'
}

/** 품목명 정규화 (공백 정리, 단위 제거) */
function normalizeItemName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, '')
    .replace(/[0-9]+\s*(kg|g|개|박스|봉|팩|L|ml|EA)/gi, '')
    .trim()
    .slice(0, 100)
}

/** 카테고리 매핑 테이블 빌드 */
function buildCategoryMap(cats: any[]): Map<string, number> {
  const map = new Map<string, number>()
  const rules: [string[], string][] = [
    [['채소','야채','상추','양파','감자','당근','배추','무','파','시금치','브로콜리','오이','호박','고추'], 'VEGGIE'],
    [['육류','돼지','소고기','닭','쇠고기','삼겹','등심','안심','갈비','다짐육','햄','소시지'], 'MEAT'],
    [['수산','생선','갈치','고등어','조기','새우','오징어','참치','전복','낙지'], 'SEAFOOD'],
    [['쌀','잡곡','밀가루','빵','떡','면','국수','파스타','라면','보리','귀리'], 'GRAIN'],
    [['우유','치즈','버터','요구르트','크림','계란','달걀'], 'DAIRY'],
    [['소스','간장','된장','고추장','기름','식용유','참기름','소금','설탕','식초','통조림'], 'PROCESSED'],
    [['용기','비닐','장갑','세제','마스크','소독','청소','소모품'], 'SUPPLIES'],
  ]
  cats.forEach(cat => {
    const codeToId = new Map(cats.map(c => [c.code, c.id]))
    rules.forEach(([keywords, code]) => {
      keywords.forEach(kw => map.set(kw, codeToId.get(code) || cat.id))
    })
  })
  return map
}

/** 품목명으로 카테고리 ID 추정 */
function guessCategoryId(name: string, catMap: Map<string, number>): number | null {
  for (const [keyword, id] of catMap.entries()) {
    if (name.includes(keyword)) return id
  }
  return null
}

/** 연도/월 숫자 비교값 반환 (6개월 전) */
function getPrevYearMonth(year: number, month: number, months: number): number {
  let y = year, m = month - months
  while (m <= 0) { m += 12; y-- }
  return y * 100 + m
}

/** 규칙 기반 AI 알림 생성 */
async function generateAlerts(db: D1Database, hospitalId: number, year: number, month: number, prevYear: number, prevMonth: number) {
  const alerts: any[] = []

  // 가격 상승 감지 (전월 대비 10%+ 상승 품목)
  try {
    const priceChanges = await db.prepare(`
      SELECT a.item_name_normalized AS item_name,
             a.avg_price AS current_price,
             b.avg_price AS prev_price,
             (CAST(a.avg_price - b.avg_price AS REAL) / NULLIF(b.avg_price,0) * 100) AS change_pct
      FROM (
        SELECT item_name_normalized, AVG(unit_price) AS avg_price
        FROM transaction_items
        WHERE hospital_id=? AND document_year=? AND document_month=? AND unit_price > 0
        GROUP BY item_name_normalized
      ) a
      JOIN (
        SELECT item_name_normalized, AVG(unit_price) AS avg_price
        FROM transaction_items
        WHERE hospital_id=? AND document_year=? AND document_month=? AND unit_price > 0
        GROUP BY item_name_normalized
      ) b ON a.item_name_normalized = b.item_name_normalized
      WHERE ABS(CAST(a.avg_price - b.avg_price AS REAL) / NULLIF(b.avg_price,0)) >= 0.1
      ORDER BY ABS(change_pct) DESC LIMIT 5
    `).bind(hospitalId, year, month, hospitalId, prevYear, prevMonth).all<any>()

    if (priceChanges.results.length > 0) {
      alerts.push({
        type: 'price_rise',
        level: 'warning',
        title: '가격 변동 감지',
        items: priceChanges.results.map((r: any) => ({
          item: r.item_name,
          change_pct: Math.round(r.change_pct * 10) / 10,
          current: r.current_price,
          prev: r.prev_price
        }))
      })
    }
  } catch (_) {}

  // 구매량 급증 감지 (전월 대비 2배+ 증가)
  try {
    const qtySurge = await db.prepare(`
      SELECT a.item_name_normalized AS item_name,
             a.total_qty AS current_qty, b.total_qty AS prev_qty,
             (CAST(a.total_qty AS REAL) / NULLIF(b.total_qty,0)) AS ratio
      FROM (
        SELECT item_name_normalized, SUM(quantity) AS total_qty
        FROM transaction_items
        WHERE hospital_id=? AND document_year=? AND document_month=?
        GROUP BY item_name_normalized
      ) a
      JOIN (
        SELECT item_name_normalized, SUM(quantity) AS total_qty
        FROM transaction_items
        WHERE hospital_id=? AND document_year=? AND document_month=?
        GROUP BY item_name_normalized
      ) b ON a.item_name_normalized = b.item_name_normalized
      WHERE a.total_qty > b.total_qty * 2 AND b.total_qty > 0
      ORDER BY ratio DESC LIMIT 5
    `).bind(hospitalId, year, month, hospitalId, prevYear, prevMonth).all<any>()

    if (qtySurge.results.length > 0) {
      alerts.push({
        type: 'qty_surge',
        level: 'warning',
        title: '구매량 급증',
        items: qtySurge.results.map((r: any) => ({
          item: r.item_name,
          ratio: Math.round(r.ratio * 10) / 10,
          current: r.current_qty,
          prev: r.prev_qty
        }))
      })
    }
  } catch (_) {}

  // 업체 집중도 경고 (단일 업체 비중 60%+)
  try {
    const vendors = await db.prepare(`
      SELECT vendor_name, SUM(amount) AS total
      FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
      GROUP BY vendor_name ORDER BY total DESC
    `).bind(hospitalId, year, month).all<any>()

    const grandTotal = vendors.results.reduce((s: number, v: any) => s + v.total, 0)
    if (vendors.results.length > 0 && grandTotal > 0) {
      const top = vendors.results[0] as any
      const ratio = top.total / grandTotal
      if (ratio >= 0.6) {
        alerts.push({
          type: 'vendor_concentration',
          level: ratio >= 0.8 ? 'critical' : 'warning',
          title: '업체 발주 집중 경고',
          vendor: top.vendor_name,
          ratio: Math.round(ratio * 100)
        })
      }
    }
  } catch (_) {}

  return alerts
}

/** 발주 vs 명세서 교차 분석 */
function buildCrossAnalysis(orders: any[], invoices: any[]): any[] {
  const result: any[] = []

  // 발주 데이터를 Map으로
  const orderMap = new Map<string, any>()
  orders.forEach(o => {
    const key = `${normalizeItemName(o.item_name || '')}__${o.vendor_name || ''}`
    orderMap.set(key, o)
  })

  // 명세서 기준으로 매핑
  invoices.forEach(inv => {
    const key = `${normalizeItemName(inv.item_name || '')}__${inv.vendor_name || ''}`
    const ord = orderMap.get(key)

    const ordQty = ord?.ordered_qty || 0
    const invQty = inv.invoice_qty || 0
    const ordPrice = ord?.ordered_unit_price || 0
    const invPrice = inv.invoice_unit_price || 0

    const qtyDiff = invQty - ordQty
    const qtyRatio = ordQty > 0 ? Math.abs(qtyDiff / ordQty) : 0
    const priceDiff = invPrice - ordPrice
    const priceRatio = ordPrice > 0 ? Math.abs(priceDiff / ordPrice) : 0

    let alertLevel = 'normal'
    let alertMemo  = ''
    if (qtyRatio >= 0.2 || priceRatio >= 0.1) alertLevel = 'warning'
    if (qtyRatio >= 0.5 || priceRatio >= 0.2) alertLevel = 'critical'

    if (qtyRatio >= 0.1) alertMemo += `수량 차이 ${(qtyDiff > 0 ? '+' : '')}${qtyDiff.toFixed(1)} `
    if (priceRatio >= 0.05) alertMemo += `단가 차이 ${priceDiff > 0 ? '+' : ''}${priceDiff.toLocaleString()}원`

    result.push({
      item_name: inv.item_name,
      vendor_name: inv.vendor_name,
      ordered_qty: ordQty,
      invoice_qty: invQty,
      qty_diff: qtyDiff,
      qty_diff_pct: Math.round(qtyRatio * 100),
      ordered_price: ordPrice,
      invoice_price: invPrice,
      price_diff: priceDiff,
      price_diff_pct: Math.round(priceRatio * 100),
      ordered_amount: ord?.ordered_amount || 0,
      invoice_amount: inv.invoice_amount || 0,
      alert_level: alertLevel,
      alert_memo: alertMemo.trim()
    })
  })

  // 정렬: critical → warning → normal
  return result.sort((a, b) => {
    const order: any = { critical: 0, warning: 1, normal: 2 }
    return (order[a.alert_level] || 2) - (order[b.alert_level] || 2)
  })
}

export default txRouter
