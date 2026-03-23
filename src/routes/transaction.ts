import { Hono } from 'hono'

const txRouter = new Hono<{ Bindings: { DB: D1Database } }>()

// ── 관리자/병원 공통 hospitalId 헬퍼 ──────────────────────────────────
// 관리자(hospitalId=null)는 body/query의 hospital_id를 우선 사용,
// 없으면 첫 번째 병원(id=1)을 기본값으로 사용
async function resolveHospitalId(c: any, bodyHospitalId?: number | null): Promise<number> {
  const user = (c as any).get('user')
  const userHospitalId = user?.hospitalId ? Number(user.hospitalId) : null

  // 일반 병원 유저
  if (userHospitalId && userHospitalId > 0) return userHospitalId

  // 관리자: body/query에서 hospital_id 받음
  if (bodyHospitalId && bodyHospitalId > 0) return bodyHospitalId

  // 관리자: query string에서 시도
  const qHid = c.req.query?.('hospital_id')
  if (qHid && Number(qHid) > 0) return Number(qHid)

  // 최후 fallback: DB에서 첫 번째 병원 ID 조회
  try {
    const first = await c.env.DB.prepare(`SELECT id FROM hospitals ORDER BY id LIMIT 1`).first<any>()
    return first?.id || 1
  } catch { return 1 }
}

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
    const hospitalId = await resolveHospitalId(c)
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
    const body = await c.req.json()
    const {
      file_name, file_type, file_size,
      file_data,          // Base64 데이터 (클라이언트에서 파싱 후 전송)
      vendor_name, document_year, document_month,
      parsed_rows,        // 클라이언트 파싱 결과 [{item_name,qty,unit,unit_price,amount,tax_type,raw}]
      hospital_id: bodyHospitalId
    } = body
    const hospitalId = await resolveHospitalId(c, bodyHospitalId)

    if (!file_name || !file_type) {
      return c.json({ ok: false, error: '파일명과 파일 형식은 필수입니다.' }, 400)
    }
    if (!document_year || !document_month) {
      return c.json({ ok: false, error: '명세서 연도와 월을 입력해주세요.' }, 400)
    }

    // 1) 파일 레코드 생성
    await c.env.DB.prepare(`
      INSERT INTO transaction_files
        (hospital_id, file_name, file_type, file_size, vendor_name,
         document_year, document_month, parse_status, row_count, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,'processing',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `).bind(
      hospitalId, file_name, file_type, file_size || 0, vendor_name || '',
      document_year, document_month
    ).run()

    // last_row_id 대신 SELECT로 ID 직접 조회 (Wrangler D1 last_row_id=0 버그 우회)
    const fileRow = await c.env.DB.prepare(
      `SELECT id FROM transaction_files WHERE hospital_id=? AND file_name=? ORDER BY id DESC LIMIT 1`
    ).bind(hospitalId, file_name).first<any>()
    const fileId = fileRow?.id
    if (!fileId) throw new Error('파일 레코드 ID 조회 실패')

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

    await c.env.DB.prepare(`
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

    // 마찬가지로 문서 ID도 직접 조회
    const docRow = await c.env.DB.prepare(
      `SELECT id FROM transaction_documents WHERE file_id=? AND hospital_id=? ORDER BY id DESC LIMIT 1`
    ).bind(fileId, hospitalId).first<any>()
    const docId = docRow?.id
    if (!docId) throw new Error('문서 레코드 ID 조회 실패')

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

      const itemCode         = String(row.item_code || '').trim()
      const spec             = String(row.spec || '').trim()
      const qty              = Number(row.quantity ?? row.qty ?? 0)
      const unitPrice        = Number(row.unit_price ?? 0)
      const amount           = Number(row.amount ?? 0) || Math.round(qty * unitPrice)
      const taxType          = normalizeTaxType(row.tax_type)
      const normalized       = normalizeItemName(itemName)
      const catId            = guessCategoryId(normalized, catMap)
      // supplier_category: category_hint(파싱 시 추출된 분류명) 또는 supplier_category 필드 사용
      const supplierCategory = String(row.supplier_category || row.category_hint || '').trim()

      // 부가세 계산 우선순위:
      // 1) 파일 원본에 부가세 컬럼이 있으면 그 값 사용 (tax_amount_raw >= 0)
      // 2) 없으면 과세 품목에 한해 금액×10% 계산 (삼성웰스토리 방식)
      // ※ 절대 amount/11 역산 금지 (공급가액 기준 파일에서는 틀림)
      let taxAmount: number
      const rawTax = row.tax_amount_raw
      if (rawTax !== undefined && rawTax !== null && rawTax >= 0) {
        // 파일 원본 부가세 값 그대로 사용
        taxAmount = Number(rawTax)
      } else {
        // 부가세 컬럼 없음 → 과세면 금액의 10%, 면세/영세면 0
        taxAmount = taxType !== 'nontaxable' && taxType !== 'exempt'
          ? Math.round(amount * 0.1)
          : 0
      }

      await c.env.DB.prepare(`
        INSERT INTO transaction_items
          (document_id, file_id, hospital_id, vendor_name,
           document_year, document_month,
           item_name, item_name_normalized, item_code, spec, category_id,
           quantity, unit, unit_price, amount, tax_type, tax_amount,
           supplier_category, raw_row, is_verified, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP)
      `).bind(
        docId, fileId, hospitalId, vendor_name || '',
        document_year, document_month,
        itemName, normalized, itemCode, spec, catId,
        qty, row.unit || '', unitPrice, amount, taxType,
        taxAmount,
        supplierCategory,
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
    const hospitalId = await resolveHospitalId(c)
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
    const hospitalId = await resolveHospitalId(c)
    const itemId = c.req.param('itemId')
    const { item_name, category_id, quantity, unit, unit_price, amount, tax_type, memo } = await c.req.json()

    const amt     = amount || Math.round((quantity || 0) * (unit_price || 0))
    // 수동 수정 시 금액×10% 방식 (삼성웰스토리 등 공급가액 기준)
    const normalizedTaxType = normalizeTaxType(tax_type)
    const taxAmt  = normalizedTaxType !== 'nontaxable' && normalizedTaxType !== 'exempt'
      ? Math.round(amt * 0.1)
      : 0

    await c.env.DB.prepare(`
      UPDATE transaction_items SET
        item_name=?, item_name_normalized=?, category_id=?,
        quantity=?, unit=?, unit_price=?, amount=?, tax_type=?,
        tax_amount=?, memo=?, is_verified=1
      WHERE id=? AND hospital_id=?
    `).bind(
      item_name, normalizeItemName(item_name || ''), category_id || null,
      quantity || 0, unit || '', unit_price || 0, amt,
      normalizedTaxType,
      taxAmt,
      memo || '', itemId, hospitalId
    ).run()

    return c.json({ ok: true, data: { amount: amt, tax_amount: taxAmt } })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// [파일] 파일 삭제 (cascade → 문서/품목 함께 삭제)
// ─────────────────────────────────────────────
txRouter.delete('/files/:fileId', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
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
    const hospitalId = await resolveHospitalId(c)
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
    const hospitalId = await resolveHospitalId(c)
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
    const hospitalId = await resolveHospitalId(c)
    const year  = Number(c.req.query('year')  || new Date().getFullYear())
    const month = Number(c.req.query('month') || new Date().getMonth() + 1)

    const mm = String(month).padStart(2, '0')
    const dateStart = `${year}-${mm}-01`
    const dateEnd   = `${year}-${mm}-31`

    // 발주 데이터 (daily_orders + vendors 조인, 업체별 월 합산)
    // 주의: daily_orders는 품목별 상세가 없으므로 업체+월 단위로 비교
    const orderData = await c.env.DB.prepare(`
      SELECT
        v.name AS vendor_name,
        SUM(d.total_amount)   AS ordered_amount,
        SUM(d.taxable_amount) AS ordered_taxable,
        COUNT(*)              AS order_count
      FROM daily_orders d
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.hospital_id=? AND d.order_date BETWEEN ? AND ?
      GROUP BY v.name
      ORDER BY ordered_amount DESC
    `).bind(hospitalId, dateStart, dateEnd).all<any>()

    // 명세서 데이터 (업체별 합산)
    const invoiceData = await c.env.DB.prepare(`
      SELECT vendor_name,
             SUM(amount)    AS invoice_amount,
             SUM(CASE WHEN tax_type='taxable' THEN amount ELSE 0 END) AS invoice_taxable,
             COUNT(DISTINCT item_name_normalized) AS item_count
      FROM transaction_items
      WHERE hospital_id=? AND document_year=? AND document_month=?
      GROUP BY vendor_name
      ORDER BY invoice_amount DESC
    `).bind(hospitalId, year, month).all<any>()

    // 업체 단위 교차 비교
    const orderMap = new Map<string, any>()
    orderData.results.forEach((o: any) => orderMap.set(o.vendor_name || '', o))

    const discrepancies: any[] = []
    const allVendors = new Set([
      ...orderData.results.map((o: any) => o.vendor_name),
      ...invoiceData.results.map((i: any) => i.vendor_name)
    ])

    allVendors.forEach(vendor => {
      const ord = orderMap.get(vendor)
      const inv = invoiceData.results.find((i: any) => i.vendor_name === vendor)
      const ordAmt = ord?.ordered_amount || 0
      const invAmt = inv?.invoice_amount || 0
      const diff = invAmt - ordAmt
      const diffRatio = ordAmt > 0 ? Math.abs(diff / ordAmt) : (invAmt > 0 ? 1 : 0)

      let alertLevel = 'normal'
      if (diffRatio >= 0.1) alertLevel = 'warning'
      if (diffRatio >= 0.3) alertLevel = 'critical'

      discrepancies.push({
        vendor_name: vendor,
        ordered_amount: ordAmt,
        invoice_amount: invAmt,
        amount_diff: diff,
        amount_diff_pct: Math.round(diffRatio * 100),
        order_count: ord?.order_count || 0,
        invoice_item_count: inv?.item_count || 0,
        alert_level: alertLevel,
        alert_memo: diff > 0
          ? `명세서가 발주보다 ${diff.toLocaleString()}원 많음`
          : diff < 0
            ? `발주가 명세서보다 ${Math.abs(diff).toLocaleString()}원 많음`
            : ''
      })
    })

    discrepancies.sort((a, b) => Math.abs(b.amount_diff) - Math.abs(a.amount_diff))

    const summary = {
      total_order_amount:   orderData.results.reduce((s: number, r: any) => s + (r.ordered_amount || 0), 0),
      total_invoice_amount: invoiceData.results.reduce((s: number, r: any) => s + (r.invoice_amount || 0), 0),
      matched_vendors:  discrepancies.filter(d => d.alert_level === 'normal').length,
      warning_vendors:  discrepancies.filter(d => d.alert_level === 'warning').length,
      critical_vendors: discrepancies.filter(d => d.alert_level === 'critical').length
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
    const hospitalId = await resolveHospitalId(c)
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
    const hospitalId = await resolveHospitalId(c)
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

// ── 업체별 파서 템플릿 API ──────────────────────────────────────────

// GET /vendor-templates  전체 목록
txRouter.get('/vendor-templates', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM transaction_vendor_templates ORDER BY vendor_name`
  ).all<any>()
  return c.json({ ok: true, templates: rows.results || [] })
})

// GET /vendor-templates/:name  특정 업체 템플릿
txRouter.get('/vendor-templates/:name', async (c) => {
  const name = decodeURIComponent(c.req.param('name'))
  const row = await c.env.DB.prepare(
    `SELECT * FROM transaction_vendor_templates WHERE vendor_name_normalized=? OR vendor_name LIKE ?`
  ).bind(name, `%${name}%`).first<any>()
  return c.json({ ok: true, template: row || null })
})

// POST /vendor-templates  생성/수정
txRouter.post('/vendor-templates', async (c) => {
  const body = await c.req.json()
  const {
    vendor_name, col_item_name, col_qty, col_unit, col_unit_price, col_amount,
    col_tax, skip_rows, has_category_rows, date_pattern, notes
  } = body
  if (!vendor_name) return c.json({ error: 'vendor_name 필요' }, 400)
  const normalized = vendor_name.trim().replace(/\s+/g, '')
  await c.env.DB.prepare(`
    INSERT INTO transaction_vendor_templates
      (vendor_name, vendor_name_normalized, col_item_name, col_qty, col_unit, col_unit_price,
       col_amount, col_tax, skip_rows, has_category_rows, date_pattern, notes, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(vendor_name_normalized) DO UPDATE SET
      vendor_name=excluded.vendor_name,
      col_item_name=excluded.col_item_name, col_qty=excluded.col_qty,
      col_unit=excluded.col_unit, col_unit_price=excluded.col_unit_price,
      col_amount=excluded.col_amount, col_tax=excluded.col_tax,
      skip_rows=excluded.skip_rows, has_category_rows=excluded.has_category_rows,
      date_pattern=excluded.date_pattern, notes=excluded.notes,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    vendor_name, normalized,
    col_item_name ?? 0, col_qty ?? 1, col_unit ?? 2, col_unit_price ?? 3,
    col_amount ?? 4, col_tax ?? 5, skip_rows ?? 1,
    has_category_rows ? 1 : 0, date_pattern || null, notes || null
  ).run()
  return c.json({ ok: true })
})

// DELETE /vendor-templates/:name
txRouter.delete('/vendor-templates/:name', async (c) => {
  const name = decodeURIComponent(c.req.param('name'))
  // ID로 삭제 (숫자인 경우)
  if (/^\d+$/.test(name)) {
    await c.env.DB.prepare(`DELETE FROM transaction_vendor_templates WHERE id=?`).bind(parseInt(name)).run()
  } else {
    await c.env.DB.prepare(`DELETE FROM transaction_vendor_templates WHERE vendor_name_normalized=?`).bind(name).run()
  }
  return c.json({ ok: true })
})

// PUT /vendor-templates/:id  수정
txRouter.put('/vendor-templates/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json() as any
  const normalized = (body.vendor_name || '').replace(/\s+/g, '').toLowerCase()
  await c.env.DB.prepare(`
    UPDATE transaction_vendor_templates SET
      vendor_name=?, vendor_name_normalized=?, skip_rows=?,
      col_item_name=?, col_qty=?, col_unit=?, col_unit_price=?, col_amount=?, col_tax=?,
      updated_at=datetime('now')
    WHERE id=?
  `).bind(
    body.vendor_name, normalized, body.skip_rows ?? 1,
    body.col_item_name ?? 1, body.col_qty ?? 4, body.col_unit ?? 3,
    body.col_unit_price ?? 5, body.col_amount ?? 6, body.col_tax ?? 7,
    id
  ).run()
  return c.json({ ok: true })
})

// ══════════════════════════════════════════════════════════════
// ── 분류별 분석 API (invoice category analysis) ──────────────
// ══════════════════════════════════════════════════════════════

// ── 파싱된 데이터(JSON) 저장 + supplier_category 포함 ──────────
// POST /invoice/save
// body: { hospital_id, vendor_name, year, month, trade_period,
//         total_amount, taxable_amount, tax_amount, nontaxable_amount,
//         items: [{item_code, item_name, spec, unit, quantity, unit_price, amount, tax_amount, total, supplier_category}],
//         categories: [{name, amount, vat, total, item_count}] }
txRouter.post('/invoice/save', async (c) => {
  try {
    const body = await c.req.json() as any
    const hospitalId = await resolveHospitalId(c, body.hospital_id)
    const { vendor_name, year, month, trade_period, items = [], categories = [] } = body

    if (!vendor_name || !year || !month) {
      return c.json({ ok: false, error: '업체명/연도/월 필수' }, 400)
    }

    // 1) transaction_files 레코드 upsert
    const fileRes = await c.env.DB.prepare(`
      INSERT INTO transaction_files
        (hospital_id, file_name, file_type, vendor_name, document_year, document_month,
         parse_status, row_count, updated_at)
      VALUES (?, ?, 'xlsx', ?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP)
    `).bind(
      hospitalId,
      `${vendor_name}_${year}${String(month).padStart(2,'0')}.xlsx`,
      vendor_name, Number(year), Number(month), items.length
    ).run()
    const fileId = fileRes.meta.last_row_id

    // 2) transaction_documents
    const totalAmount = categories.reduce((s: number, c: any) => s + (Number(c.total) || 0), 0)
    const taxableAmount = categories.reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0)
    const taxAmount = categories.reduce((s: number, c: any) => s + (Number(c.vat) || 0), 0)

    const docRes = await c.env.DB.prepare(`
      INSERT INTO transaction_documents
        (file_id, hospital_id, vendor_name, document_year, document_month,
         total_amount, taxable_amount, tax_amount, item_count, trade_period)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      fileId, hospitalId, vendor_name, Number(year), Number(month),
      totalAmount, taxableAmount, taxAmount, items.length, trade_period || ''
    ).run()
    const docId = docRes.meta.last_row_id

    // 3) transaction_items (배치 INSERT)
    const BATCH = 50
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH)
      const stmts = chunk.map((it: any) =>
        c.env.DB.prepare(`
          INSERT INTO transaction_items
            (document_id, file_id, hospital_id, vendor_name, document_year, document_month,
             item_code, item_name, item_name_normalized, spec, unit, quantity,
             unit_price, amount, tax_type, tax_amount, supplier_category, raw_row)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          docId, fileId, hospitalId, vendor_name, Number(year), Number(month),
          it.item_code || '',
          it.item_name || '',
          (it.item_name || '').replace(/[,\s（）()]/g, '').slice(0, 50),
          it.spec || '',
          it.unit || '',
          Number(it.quantity) || 0,
          Number(it.unit_price) || 0,
          Number(it.amount) || 0,
          (Number(it.tax_amount) || 0) > 0 ? 'taxable' : 'nontaxable',
          Number(it.tax_amount) || 0,
          it.supplier_category || '',
          JSON.stringify(it)
        )
      )
      await c.env.DB.batch(stmts)
    }

    // 4) invoice_supplier_classifications - 분류명 저장 (중복 무시)
    if (categories.length > 0) {
      const catStmts = categories.map((cat: any, idx: number) =>
        c.env.DB.prepare(`
          INSERT OR IGNORE INTO invoice_supplier_classifications
            (hospital_id, vendor_name, category_name, sort_order)
          VALUES (?,?,?,?)
        `).bind(hospitalId, vendor_name, cat.name, idx)
      )
      await c.env.DB.batch(catStmts)
    }

    return c.json({ ok: true, file_id: fileId, doc_id: docId, item_count: items.length })
  } catch (e: any) {
    console.error('[invoice/save] ERROR:', e)
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ── 저장된 분석 목록 조회 ──────────────────────────────────────
// GET /invoice/list?hospital_id=&vendor_name=&year=
txRouter.get('/invoice/list', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const vendorName = c.req.query('vendor_name') || ''
    const year = c.req.query('year') || ''

    let sql = `
      SELECT tf.id as file_id, tf.vendor_name, tf.document_year, tf.document_month,
             tf.row_count, tf.created_at,
             td.id as doc_id, td.total_amount, td.taxable_amount, td.tax_amount,
             td.item_count, td.trade_period
      FROM transaction_files tf
      LEFT JOIN transaction_documents td ON td.file_id = tf.id
      WHERE tf.hospital_id = ? AND tf.file_type = 'xlsx'
    `
    const params: any[] = [hospitalId]
    if (vendorName) { sql += ` AND tf.vendor_name = ?`; params.push(vendorName) }
    if (year)       { sql += ` AND tf.document_year = ?`; params.push(Number(year)) }
    sql += ` ORDER BY tf.document_year DESC, tf.document_month DESC, tf.id DESC`

    const rows = await c.env.DB.prepare(sql).bind(...params).all<any>()
    return c.json({ ok: true, data: rows.results || [] })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ── 분류별 집계 분석 ───────────────────────────────────────────
// GET /invoice/category-summary?hospital_id=&vendor_name=&year=&month=
txRouter.get('/invoice/category-summary', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const vendorName = c.req.query('vendor_name') || ''
    const year  = c.req.query('year')  || ''
    const month = c.req.query('month') || ''

    if (!vendorName || !year || !month) {
      return c.json({ ok: false, error: '업체명/연도/월 필수' }, 400)
    }

    // 분류별 합계
    const catRows = await c.env.DB.prepare(`
      SELECT supplier_category,
             COUNT(*) as item_count,
             SUM(amount) as total_amount,
             SUM(tax_amount) as total_vat,
             SUM(amount + tax_amount) as grand_total
      FROM transaction_items
      WHERE hospital_id=? AND vendor_name=? AND document_year=? AND document_month=?
        AND supplier_category != ''
      GROUP BY supplier_category
      ORDER BY grand_total DESC
    `).bind(hospitalId, vendorName, Number(year), Number(month)).all<any>()

    // 분류별 TOP5 품목
    const topItems = await c.env.DB.prepare(`
      SELECT supplier_category, item_name, unit, quantity, unit_price, amount, tax_amount,
             (amount + tax_amount) as total,
             ROW_NUMBER() OVER (PARTITION BY supplier_category ORDER BY amount DESC) as rn
      FROM transaction_items
      WHERE hospital_id=? AND vendor_name=? AND document_year=? AND document_month=?
        AND supplier_category != ''
      ORDER BY supplier_category, amount DESC
    `).bind(hospitalId, vendorName, Number(year), Number(month)).all<any>()

    // 전체 합계
    const totalRow = await c.env.DB.prepare(`
      SELECT COUNT(*) as item_count,
             SUM(amount) as total_amount,
             SUM(tax_amount) as total_vat,
             SUM(amount + tax_amount) as grand_total
      FROM transaction_items
      WHERE hospital_id=? AND vendor_name=? AND document_year=? AND document_month=?
    `).bind(hospitalId, vendorName, Number(year), Number(month)).first<any>()

    return c.json({
      ok: true,
      categories: catRows.results || [],
      top_items: (topItems.results || []).filter((r: any) => r.rn <= 5),
      total: totalRow
    })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ── 월별 트렌드 분석 (동일 업체, 최근 N개월) ─────────────────
// GET /invoice/monthly-trend?hospital_id=&vendor_name=&months=12
txRouter.get('/invoice/monthly-trend', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const vendorName = c.req.query('vendor_name') || ''
    const months = Number(c.req.query('months') || '12')

    if (!vendorName) return c.json({ ok: false, error: '업체명 필수' }, 400)

    // 월별 총액 트렌드
    const monthlyTotal = await c.env.DB.prepare(`
      SELECT document_year, document_month,
             SUM(amount) as total_amount,
             SUM(tax_amount) as total_vat,
             SUM(amount + tax_amount) as grand_total,
             COUNT(*) as item_count
      FROM transaction_items
      WHERE hospital_id=? AND vendor_name=?
      GROUP BY document_year, document_month
      ORDER BY document_year DESC, document_month DESC
      LIMIT ?
    `).bind(hospitalId, vendorName, months).all<any>()

    // 월별 분류별 트렌드
    const monthlyByCategory = await c.env.DB.prepare(`
      SELECT document_year, document_month, supplier_category,
             SUM(amount) as total_amount,
             SUM(tax_amount) as total_vat,
             SUM(amount + tax_amount) as grand_total,
             COUNT(*) as item_count
      FROM transaction_items
      WHERE hospital_id=? AND vendor_name=? AND supplier_category != ''
      GROUP BY document_year, document_month, supplier_category
      ORDER BY document_year DESC, document_month DESC
      LIMIT ?
    `).bind(hospitalId, vendorName, months * 10).all<any>()

    // 분류별 최근 2개월 비교 (전월 대비)
    const categoryComparison = await c.env.DB.prepare(`
      WITH ranked AS (
        SELECT supplier_category, document_year, document_month,
               SUM(amount) as total_amount,
               SUM(amount + tax_amount) as grand_total,
               COUNT(*) as item_count,
               ROW_NUMBER() OVER (PARTITION BY supplier_category ORDER BY document_year DESC, document_month DESC) as rn
        FROM transaction_items
        WHERE hospital_id=? AND vendor_name=? AND supplier_category != ''
        GROUP BY supplier_category, document_year, document_month
      )
      SELECT curr.supplier_category,
             curr.document_year as curr_year, curr.document_month as curr_month,
             curr.grand_total as curr_total, curr.item_count as curr_count,
             prev.document_year as prev_year, prev.document_month as prev_month,
             prev.grand_total as prev_total, prev.item_count as prev_count,
             ROUND((curr.grand_total - prev.grand_total) * 100.0 / prev.grand_total, 1) as change_pct
      FROM ranked curr
      LEFT JOIN ranked prev ON curr.supplier_category = prev.supplier_category AND prev.rn = 2
      WHERE curr.rn = 1
      ORDER BY curr.grand_total DESC
    `).bind(hospitalId, vendorName).all<any>()

    // 업체별 등록된 분류 목록
    const categoryList = await c.env.DB.prepare(`
      SELECT DISTINCT category_name, sort_order
      FROM invoice_supplier_classifications
      WHERE hospital_id=? AND vendor_name=?
      ORDER BY sort_order
    `).bind(hospitalId, vendorName).all<any>()

    return c.json({
      ok: true,
      monthly_total: (monthlyTotal.results || []).reverse(),
      monthly_by_category: monthlyByCategory.results || [],
      category_comparison: categoryComparison.results || [],
      categories: categoryList.results || []
    })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ── 특정 월 전체 품목 목록 ─────────────────────────────────────
// GET /invoice/items?hospital_id=&vendor_name=&year=&month=&category=
txRouter.get('/invoice/items', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const vendorName = c.req.query('vendor_name') || ''
    const year  = Number(c.req.query('year')  || 0)
    const month = Number(c.req.query('month') || 0)
    const category = c.req.query('category') || ''

    let sql = `
      SELECT id, item_code, item_name, spec, unit, quantity, unit_price,
             amount, tax_amount, (amount+tax_amount) as total,
             supplier_category, tax_type
      FROM transaction_items
      WHERE hospital_id=? AND vendor_name=? AND document_year=? AND document_month=?
    `
    const params: any[] = [hospitalId, vendorName, year, month]
    if (category) { sql += ` AND supplier_category=?`; params.push(category) }
    sql += ` ORDER BY supplier_category, amount DESC`

    const rows = await c.env.DB.prepare(sql).bind(...params).all<any>()
    return c.json({ ok: true, data: rows.results || [] })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ── 업체 목록 조회 (분석된 업체) ──────────────────────────────
// GET /invoice/vendors?hospital_id=
txRouter.get('/invoice/vendors', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const rows = await c.env.DB.prepare(`
      SELECT DISTINCT vendor_name,
             MIN(document_year) as first_year,
             MAX(document_year) as last_year,
             COUNT(DISTINCT document_year||'-'||document_month) as month_count,
             SUM(amount + tax_amount) as total_amount
      FROM transaction_items
      WHERE hospital_id=?
      GROUP BY vendor_name
      ORDER BY total_amount DESC
    `).bind(hospitalId).all<any>()
    return c.json({ ok: true, data: rows.results || [] })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ── 파일 삭제 ──────────────────────────────────────────────────
// DELETE /invoice/file/:file_id
txRouter.delete('/invoice/file/:file_id', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const fileId = Number(c.req.param('file_id'))
    // CASCADE로 items/documents도 삭제됨
    await c.env.DB.prepare(`
      DELETE FROM transaction_files WHERE id=? AND hospital_id=?
    `).bind(fileId, hospitalId).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})


// ══════════════════════════════════════════════════════════════
// ── 병원별 명세서 업체 관리 API (hospital_invoice_vendors) ────
// ══════════════════════════════════════════════════════════════

// GET /invoice-vendors  - 병원의 등록 업체 목록 (최근 업로드 정보 포함)
txRouter.get('/invoice-vendors', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const rows = await c.env.DB.prepare(`
      SELECT 
        hiv.*,
        (SELECT COUNT(*) FROM transaction_files tf
         WHERE tf.hospital_id = hiv.hospital_id AND tf.vendor_name = hiv.vendor_name
        ) AS upload_count_live,
        (SELECT MAX(tf.created_at) FROM transaction_files tf
         WHERE tf.hospital_id = hiv.hospital_id AND tf.vendor_name = hiv.vendor_name
        ) AS last_upload_at_live,
        (SELECT tf.document_year FROM transaction_files tf
         WHERE tf.hospital_id = hiv.hospital_id AND tf.vendor_name = hiv.vendor_name
         ORDER BY tf.document_year DESC, tf.document_month DESC LIMIT 1
        ) AS last_year_live,
        (SELECT tf.document_month FROM transaction_files tf
         WHERE tf.hospital_id = hiv.hospital_id AND tf.vendor_name = hiv.vendor_name
         ORDER BY tf.document_year DESC, tf.document_month DESC LIMIT 1
        ) AS last_month_live
      FROM hospital_invoice_vendors hiv
      WHERE hiv.hospital_id = ? AND hiv.is_active = 1
      ORDER BY hiv.sort_order, hiv.id
    `).bind(hospitalId).all<any>()
    return c.json({ ok: true, vendors: rows.results || [] })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// GET /invoice-vendors/:id  - 특정 업체 상세 (컬럼 매핑 포함)
txRouter.get('/invoice-vendors/:id', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const id = Number(c.req.param('id'))
    const row = await c.env.DB.prepare(`
      SELECT * FROM hospital_invoice_vendors WHERE id=? AND hospital_id=?
    `).bind(id, hospitalId).first<any>()
    if (!row) return c.json({ ok: false, error: '업체 없음' }, 404)
    return c.json({ ok: true, vendor: row })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// POST /invoice-vendors  - 업체 등록
txRouter.post('/invoice-vendors', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const body = await c.req.json() as any
    const {
      vendor_name, description = '',
      skip_rows = 4, col_code = 0, col_name = 1, col_spec = 2,
      col_unit = 3, col_qty = 4, col_price = 5,
      col_amount = 6, col_vat = 7, col_total = 8,
      cat_mode = 'subtotal', col_category = null
    } = body

    if (!vendor_name?.trim()) return c.json({ ok: false, error: '업체명 필수' }, 400)
    const norm = vendor_name.trim().replace(/\s+/g, '')

    const result = await c.env.DB.prepare(`
      INSERT INTO hospital_invoice_vendors
        (hospital_id, vendor_name, vendor_name_norm, description,
         skip_rows, col_code, col_name, col_spec, col_unit, col_qty,
         col_price, col_amount, col_vat, col_total, cat_mode, col_category,
         updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(hospital_id, vendor_name_norm) DO UPDATE SET
        vendor_name=excluded.vendor_name, description=excluded.description,
        skip_rows=excluded.skip_rows, col_code=excluded.col_code,
        col_name=excluded.col_name, col_spec=excluded.col_spec,
        col_unit=excluded.col_unit, col_qty=excluded.col_qty,
        col_price=excluded.col_price, col_amount=excluded.col_amount,
        col_vat=excluded.col_vat, col_total=excluded.col_total,
        cat_mode=excluded.cat_mode, col_category=excluded.col_category,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      hospitalId, vendor_name.trim(), norm, description,
      skip_rows, col_code, col_name, col_spec, col_unit, col_qty,
      col_price, col_amount, col_vat, col_total, cat_mode, col_category ?? null
    ).run()

    const newRow = await c.env.DB.prepare(
      `SELECT * FROM hospital_invoice_vendors WHERE hospital_id=? AND vendor_name_norm=?`
    ).bind(hospitalId, norm).first<any>()
    return c.json({ ok: true, vendor: newRow })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// PUT /invoice-vendors/:id  - 업체 수정
txRouter.put('/invoice-vendors/:id', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const id = Number(c.req.param('id'))
    const body = await c.req.json() as any
    const {
      vendor_name, description,
      skip_rows, col_code, col_name, col_spec, col_unit, col_qty,
      col_price, col_amount, col_vat, col_total, cat_mode, col_category,
      test_status, test_sample_rows
    } = body

    await c.env.DB.prepare(`
      UPDATE hospital_invoice_vendors SET
        vendor_name=COALESCE(?,vendor_name),
        description=COALESCE(?,description),
        skip_rows=COALESCE(?,skip_rows),
        col_code=COALESCE(?,col_code), col_name=COALESCE(?,col_name),
        col_spec=COALESCE(?,col_spec), col_unit=COALESCE(?,col_unit),
        col_qty=COALESCE(?,col_qty), col_price=COALESCE(?,col_price),
        col_amount=COALESCE(?,col_amount), col_vat=COALESCE(?,col_vat),
        col_total=COALESCE(?,col_total), cat_mode=COALESCE(?,cat_mode),
        col_category=?,
        test_status=COALESCE(?,test_status),
        test_sample_rows=COALESCE(?,test_sample_rows),
        test_verified_at=CASE WHEN ?='verified' THEN CURRENT_TIMESTAMP ELSE test_verified_at END,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND hospital_id=?
    `).bind(
      vendor_name ?? null, description ?? null,
      skip_rows ?? null, col_code ?? null, col_name ?? null,
      col_spec ?? null, col_unit ?? null, col_qty ?? null,
      col_price ?? null, col_amount ?? null, col_vat ?? null,
      col_total ?? null, cat_mode ?? null, col_category ?? null,
      test_status ?? null,
      test_sample_rows ? JSON.stringify(test_sample_rows) : null,
      test_status ?? null,
      id, hospitalId
    ).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// DELETE /invoice-vendors/:id  - 업체 삭제 (soft delete)
txRouter.delete('/invoice-vendors/:id', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const id = Number(c.req.param('id'))
    await c.env.DB.prepare(`
      UPDATE hospital_invoice_vendors SET is_active=0, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND hospital_id=?
    `).bind(id, hospitalId).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// POST /invoice-vendors/:id/test  - 파싱 구조 테스트 결과 저장
txRouter.post('/invoice-vendors/:id/test', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const id = Number(c.req.param('id'))
    const body = await c.req.json() as any
    const { success, sample_rows } = body   // sample_rows: 파싱된 샘플 3행

    await c.env.DB.prepare(`
      UPDATE hospital_invoice_vendors SET
        test_status = ?,
        test_sample_rows = ?,
        test_verified_at = CASE WHEN ? = 'verified' THEN CURRENT_TIMESTAMP ELSE test_verified_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id=? AND hospital_id=?
    `).bind(
      success ? 'verified' : 'failed',
      sample_rows ? JSON.stringify(sample_rows) : null,
      success ? 'verified' : 'failed',
      id, hospitalId
    ).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// POST /invoice-vendors/:id/upload-sync  - 업로드 후 최근 업로드 정보 갱신
txRouter.post('/invoice-vendors/:id/upload-sync', async (c) => {
  try {
    const hospitalId = await resolveHospitalId(c)
    const id = Number(c.req.param('id'))
    const body = await c.req.json() as any
    const { year, month } = body

    await c.env.DB.prepare(`
      UPDATE hospital_invoice_vendors SET
        last_upload_at = CURRENT_TIMESTAMP,
        last_upload_year = ?,
        last_upload_month = ?,
        upload_count = upload_count + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id=? AND hospital_id=?
    `).bind(year, month, id, hospitalId).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

export default txRouter

