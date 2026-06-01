// ── executive.js ── 운영진 전용 대시보드
// 버전: 20260529-bugfix3

;(function() {
'use strict'

// ── 상태 ─────────────────────────────────────────────────────────
const State = {
  token: localStorage.getItem('token'),
  role: localStorage.getItem('role'),
  username: localStorage.getItem('username'),
  hospitalName: localStorage.getItem('hospitalName'),
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  data: null,
  annualData: null,
  scoreData: null,      // 운영 종합 점수 API 결과
  activeTab: 'overview',
  viewStyle: localStorage.getItem('execViewStyle') || 'SUMMARY', // SUMMARY / ANALYSIS / DETAIL
  charts: {}
}

// ── 초기화 ────────────────────────────────────────────────────────
function initExec() {
  // 인증 체크
  if (!State.token || (State.role !== 'executive' && State.role !== 'admin')) {
    alert('운영진 권한이 필요합니다.')
    location.href = '/login'
    return
  }
  updateMonthDisplay()
  initViewStyleButtons()
  loadExecData()
}

// DOMContentLoaded가 이미 발생했거나 발생 전이나 모두 처리
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExec)
} else {
  // 이미 DOM 준비됨
  initExec()
}

// ── API 헬퍼 ──────────────────────────────────────────────────────
async function api(method, path, body) {
  try {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${State.token}`
      }
    }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(path, opts)
    if (res.status === 401 || res.status === 403) {
      localStorage.clear()
      location.href = '/login'
      return null
    }
    return await res.json()
  } catch(e) {
    console.error('API Error:', e)
    return null
  }
}

// ── CSV 다운로드 헬퍼 (Authorization 헤더 포함) ──────────────────
window.execDownloadCSV = async function(type) {
  const yStr = String(State.year)
  const mStr = String(State.month).padStart(2,'0')
  const urlMap = {
    budget:  `/api/executive/export/budget/${yStr}/${mStr}`,
    vendors: `/api/executive/export/vendors/${yStr}/${mStr}`,
    labor:   `/api/executive/export/labor/${yStr}/${mStr}`,
    card:    `/api/executive/export/card/${yStr}/${mStr}`,
  }
  const labelMap = {
    budget:'예산', vendors:'발주', labor:'인건비', card:'카드'
  }
  const url = urlMap[type]
  if (!url) return

  // 버튼 로딩 상태
  const btn = document.getElementById('csvBtn-' + type)
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6' }

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${State.token}` }
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(`CSV 생성 실패\n${err.error || res.status + ' ' + res.statusText}\n데이터를 불러올 수 없습니다.`)
      return
    }
    const blob = await res.blob()
    // Content-Disposition에서 파일명 추출
    const disposition = res.headers.get('content-disposition') || ''
    let fileName = `${labelMap[type] || type}_${yStr}년${mStr}월.csv`
    const fnMatch = disposition.match(/filename\*=UTF-8''(.+)/)
    if (fnMatch) {
      try { fileName = decodeURIComponent(fnMatch[1]) } catch(e) {}
    }
    // Blob URL로 다운로드
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  } catch(e) {
    alert(`CSV 다운로드 오류\n${e.message}\n네트워크 연결을 확인해 주세요.`)
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1' }
  }
}

// ── 뷰 스타일 전환 ────────────────────────────────────────────────
window.execSetViewStyle = function(style) {
  State.viewStyle = style
  localStorage.setItem('execViewStyle', style)
  // 토글 버튼 active 클래스 갱신
  ;['SUMMARY','ANALYSIS','DETAIL'].forEach(s => {
    const btn = document.getElementById('vsBtn-' + s)
    if (!btn) return
    if (s === style) btn.classList.add('vs-active')
    else btn.classList.remove('vs-active')
  })
  // 데이터가 이미 있으면 재렌더 (API 재호출 없이)
  if (State.data) renderAll()
}

function initViewStyleButtons() {
  ;['SUMMARY','ANALYSIS','DETAIL'].forEach(s => {
    const btn = document.getElementById('vsBtn-' + s)
    if (!btn) return
    if (s === State.viewStyle) btn.classList.add('vs-active')
    else btn.classList.remove('vs-active')
  })
}

// ── 월 표시 업데이트 ────────────────────────────────────────────
function updateMonthDisplay() {
  const el = document.getElementById('execMonthDisplay')
  if (el) el.textContent = `${State.year}년 ${String(State.month).padStart(2,'0')}월`
}

// ── 월 변경 ───────────────────────────────────────────────────────
window.execChangeMonth = function(delta) {
  let m = State.month + delta
  let y = State.year
  if (m < 1) { m = 12; y-- }
  if (m > 12) { m = 1; y++ }
  State.month = m; State.year = y
  updateMonthDisplay()
  loadExecData()
}

// ── 로그아웃 ─────────────────────────────────────────────────────
window.execLogout = function() {
  localStorage.clear()
  location.href = '/login'
}

// ── 숫자 포맷 ────────────────────────────────────────────────────
function fmt(n) {
  return (n||0).toLocaleString('ko-KR')
}
function fmtM(n) {
  const v = Math.abs(n||0)
  if (v >= 100000000) return `${(n/100000000).toFixed(1)}억`
  if (v >= 10000) return `${Math.round(n/10000)}만`
  return fmt(n)
}
function fmtW(n) {
  return `${fmt(n)}원`
}
function fmtPct(n) {
  return `${(n||0).toFixed(1)}%`
}
function progressColor(pct) {
  if (pct >= 100) return '#ef4444'
  if (pct >= 85) return '#f59e0b'
  return '#16a34a'
}

// ── 데이터 로드 ───────────────────────────────────────────────────
window.loadExecData = async function() {
  const loading = document.getElementById('execLoading')
  const content = document.getElementById('execContent')
  const icon = document.getElementById('execRefreshIcon')
  if (loading) loading.classList.remove('hidden')
  if (content) content.classList.add('hidden')
  if (icon) icon.classList.add('loading-spin')

  try {
    const yStr = String(State.year)
    const mStr = String(State.month).padStart(2,'0')
    // SUMMARY/ANALYSIS 모드에서도 score는 항상 호출
    // annual/staffLabor/schedule은 DETAIL에서 완전 활용, ANALYSIS에서도 차트용 활용
    const [summary, annual, staffLabor, scheduleMonth, scoreData] = await Promise.all([
      api('GET', `/api/executive/summary/${yStr}/${mStr}`),
      api('GET', `/api/executive/annual/${yStr}`),
      api('GET', `/api/executive/staff-labor/${yStr}/${mStr}`).catch(() => null),
      api('GET', `/api/schedule/${yStr}/${mStr}`).catch(() => null),
      api('GET', `/api/executive/score/${yStr}/${mStr}`).catch(() => null)
    ])

    if (icon) icon.classList.remove('loading-spin')

    if (!summary || summary.error) {
      if (loading) loading.innerHTML = `
        <div class="text-center">
          <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3 block"></i>
          <p class="text-red-500 font-semibold">데이터를 불러올 수 없습니다</p>
          <p class="text-gray-400 text-sm mt-1">${summary?.error || '서버 오류'}</p>
          <button onclick="loadExecData()" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">다시 시도</button>
        </div>`
      return
    }

    State.data = summary
    State.annualData = annual
    State.staffLabor = staffLabor
    State.scheduleMonth = scheduleMonth
    State.scoreData = scoreData

    // 병원명 업데이트
    const hospName = summary.hospital?.name || State.hospitalName || '운영 현황'
    const el = document.getElementById('execHospName')
    if (el) el.textContent = hospName
    const pl = document.getElementById('execPeriodLabel')
    if (pl) pl.textContent = `${State.year}년 ${State.month}월 현황`

    if (loading) loading.classList.add('hidden')
    if (content) {
      content.classList.remove('hidden')
      try {
        renderAll()
      } catch(renderErr) {
        console.error('renderAll error:', renderErr)
        content.innerHTML = `
          <div class="text-center py-10">
            <i class="fas fa-exclamation-triangle text-3xl text-amber-400 mb-3 block"></i>
            <p class="text-gray-600 font-semibold">화면 렌더링 중 오류가 발생했습니다</p>
            <p class="text-gray-400 text-sm mt-1">${renderErr.message}</p>
            <button onclick="loadExecData()" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">새로고침</button>
          </div>`
        content.classList.remove('hidden')
      }
    }
  } catch(e) {
    if (icon) icon.classList.remove('loading-spin')
    if (loading) loading.innerHTML = `
      <div class="text-center">
        <i class="fas fa-wifi text-3xl text-red-400 mb-3 block"></i>
        <p class="text-red-500 font-semibold">네트워크 오류</p>
        <p class="text-gray-400 text-sm mt-1">${e.message}</p>
        <button onclick="loadExecData()" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">다시 시도</button>
      </div>`
    console.error('loadExecData error:', e)
  }
}

// ══════════════════════════════════════════════════════════════════
// ── 뷰 스타일별 렌더 분기 (전면 개편) ────────────────────────────
// ══════════════════════════════════════════════════════════════════

function renderAll() {
  const content = document.getElementById('execContent')
  if (!content) return

  const vs = State.viewStyle || 'SUMMARY'

  // 공통 파생값 계산
  const d = State.data || {}
  const budget = d.budget || {}
  const mealStats = d.mealStats || {}
  const vendorOrders = d.vendorOrders || []
  const cardExpenses = d.cardExpenses || []
  const transactions = d.transactions || []
  const schedules = d.schedules || []
  const catOrders = d.catOrders || []
  const prevMonth = d.prevMonth || {}
  const dp = d.dietPrices || {}
  const sl = State.staffLabor || {}

  const progressPct  = budget.progress || 0
  const repPrice     = dp.representative || budget.currentMealPrice || 0
  const operPrice    = dp.operating || budget.mealPriceOperating || 0
  const prevMealPrice = prevMonth.mealPrice || 0
  const totalMeals   = dp.totalMeals || mealStats.totalMeals || 0
  const targetPrice  = budget.targetMealPrice || 0
  const cardTotal    = d.cardTotal || 0
  const supplyTotal  = vendorOrders.filter(v => v.category === 'supply').reduce((s,v) => s+(v.total_used||0), 0)
  const eventTotal   = vendorOrders.filter(v => v.category === 'event').reduce((s,v) => s+(v.total_used||0), 0)
  const cardVendorTotal = vendorOrders.filter(v => v.category === 'card').reduce((s,v) => s+(v.total_used||0), 0)
  const supplyPerMeal = totalMeals > 0 ? Math.round(supplyTotal / totalMeals) : 0

  // 뷰별 렌더
  if (vs === 'SUMMARY') {
    renderSummaryView(content, budget, dp, sl, mealStats, progressPct, repPrice, operPrice, targetPrice, totalMeals, vendorOrders)
  } else if (vs === 'ANALYSIS') {
    renderAnalysisView(content, budget, dp, sl, mealStats, vendorOrders, prevMonth, progressPct, repPrice, operPrice, targetPrice, totalMeals, supplyPerMeal, cardTotal, eventTotal, cardVendorTotal)
  } else {
    renderDetailView(content, budget, dp, sl, mealStats, vendorOrders, cardExpenses, transactions, schedules, catOrders, prevMonth, progressPct, repPrice, operPrice, targetPrice, totalMeals, supplyPerMeal, cardTotal, eventTotal, cardVendorTotal)
  }
}

// ── SUMMARY 뷰 ────────────────────────────────────────────────────
function renderSummaryView(content, budget, dp, sl, mealStats, progressPct, repPrice, operPrice, targetPrice, totalMeals, vendorOrders) {
  content.innerHTML = `
    <!-- 리스크 알림 (권고사항 강화) -->
    ${renderExecRiskBannerEnhanced(sl, budget, repPrice, targetPrice)}
    <!-- KPI 6개 카드 -->
    <div class="grid grid-cols-2 gap-4" id="kpiGrid">
      ${kpiCardBudget(budget, progressPct)}
      ${kpiCardMealPrice(repPrice, targetPrice, operPrice)}
      ${kpiCardLabor(sl)}
      ${kpiCardRisk(sl, budget, repPrice, targetPrice)}
      ${kpiCardMeals(mealStats, totalMeals)}
      ${kpiCardScore(State.scoreData)}
    </div>
    <!-- 경영 트렌드 Sparkline -->
    ${renderTrendSparklines()}
    <!-- SUMMARY 안내 -->
    <div class="flex items-center gap-2 px-1" style="opacity:0.6">
      <i class="fas fa-hand-pointer text-blue-400 text-xs flex-shrink-0"></i>
      <p class="text-xs text-gray-400">카드 클릭 → 상세 내용 확인 · 차트·테이블은 <strong>분석</strong> 또는 <strong>상세</strong> 모드</p>
    </div>
  `
  // Sparkline 차트 초기화 (annual 데이터 있을 때만)
  setTimeout(() => initSparklineCharts(), 80)
}

// ── 경영 트렌드 Sparkline 섹션 ───────────────────────────────────
// ── 경영 트렌드 Sparkline 섹션 ───────────────────────────────────
function renderTrendSparklines() {
  const annual = State.annualData
  if (!annual) return ''
  const orders  = annual.monthly || []
  const budgets = annual.budgets  || []
  if (orders.length === 0 && budgets.length === 0) return ''

  return `
  <div class="exec-card" style="padding:20px 20px 16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h3 style="font-size:12px;font-weight:700;color:#475569;letter-spacing:0.06em;text-transform:uppercase;display:flex;align-items:center;gap:6px">
        <i class="fas fa-chart-line" style="color:#6366f1;font-size:11px"></i>경영 트렌드 · 최근 6개월
      </h3>
      <span style="font-size:10px;color:#cbd5e1;letter-spacing:0.03em">분석 모드에서 전체 차트 확인</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <!-- 예산 사용률 -->
      <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0">
        <div style="font-size:10px;font-weight:600;color:#64748b;margin-bottom:2px;display:flex;align-items:center;gap:4px">
          <i class="fas fa-wallet" style="color:#3b82f6;font-size:9px"></i> 예산 사용률
        </div>
        <div id="sparkBudgetVal" style="font-size:15px;font-weight:800;color:#1e293b;line-height:1.2;margin-bottom:6px">—</div>
        <div style="position:relative;height:48px;width:100%">
          <canvas id="sparkBudget"></canvas>
        </div>
      </div>
      <!-- 식단가 추세 -->
      <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0">
        <div style="font-size:10px;font-weight:600;color:#64748b;margin-bottom:2px;display:flex;align-items:center;gap:4px">
          <i class="fas fa-utensils" style="color:#16a34a;font-size:9px"></i> 식단가
        </div>
        <div id="sparkMealVal" style="font-size:15px;font-weight:800;color:#1e293b;line-height:1.2;margin-bottom:6px">—</div>
        <div style="position:relative;height:48px;width:100%">
          <canvas id="sparkMealPrice"></canvas>
        </div>
      </div>
      <!-- 발주금액 추세 -->
      <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0">
        <div style="font-size:10px;font-weight:600;color:#64748b;margin-bottom:2px;display:flex;align-items:center;gap:4px">
          <i class="fas fa-boxes" style="color:#d97706;font-size:9px"></i> 발주금액
        </div>
        <div id="sparkOrderVal" style="font-size:15px;font-weight:800;color:#1e293b;line-height:1.2;margin-bottom:6px">—</div>
        <div style="position:relative;height:48px;width:100%">
          <canvas id="sparkOrder"></canvas>
        </div>
      </div>
    </div>
  </div>`
}

// ── Sparkline 차트 초기화 ─────────────────────────────────────────
function initSparklineCharts() {
  if (typeof Chart === 'undefined') return
  const annual = State.annualData
  if (!annual) return

  const currentMonth = State.month || new Date().getMonth() + 1
  const monthRange = []
  for (let i = 5; i >= 0; i--) {
    let m = currentMonth - i
    if (m <= 0) m += 12
    monthRange.push(String(m).padStart(2, '0'))
  }

  const budgetMap = {}
  ;(annual.budgets || []).forEach(b => { budgetMap[String(parseInt(b.month)).padStart(2,'0')] = b })
  const orderMap = {}
  ;(annual.monthly || []).forEach(r => { orderMap[String(r.month).padStart(2,'0')] = r })

  const merged = monthRange.map(mKey => {
    const b = budgetMap[mKey] || {}
    const o = orderMap[mKey]  || {}
    const budget    = b.total_budget || 0
    const used      = o.total_used   || 0
    const mealPrice = b.meal_price   || null
    const rate = budget > 0 ? parseFloat(((used / budget) * 100).toFixed(1)) : null
    return { mKey, month: parseInt(mKey), rate, mealPrice, used, budget }
  })

  // 각 지표별 유효 데이터 포인트 개수 (Sparkline은 2개 이상일 때만 의미 있음)
  const budgetCount = merged.filter(r => r.rate      != null).length
  const mealCount   = merged.filter(r => r.mealPrice != null).length
  const orderCount  = merged.filter(r => r.used       > 0).length
  const labels6 = merged.map(r => `${r.month}월`)

  // 최신값 라벨 업데이트
  const lastBudget = [...merged].reverse().find(r => r.rate != null)
  const lastMeal   = [...merged].reverse().find(r => r.mealPrice != null)
  const lastOrder  = [...merged].reverse().find(r => r.used > 0)
  const bvEl = document.getElementById('sparkBudgetVal')
  const mvEl = document.getElementById('sparkMealVal')
  const ovEl = document.getElementById('sparkOrderVal')
  if (bvEl) bvEl.textContent = lastBudget ? lastBudget.rate.toFixed(1) + '%' : '—'
  if (mvEl) {
    if (lastMeal) mvEl.textContent = fmtW(Math.round(lastMeal.mealPrice))
    else { mvEl.textContent = '미설정'; mvEl.style.fontSize = '12px'; mvEl.style.color = '#94a3b8' }
  }
  if (ovEl) ovEl.textContent = lastOrder  ? fmtM(lastOrder.used) : '—'

  // 트렌드 방향 색상 (마지막 2포인트 비교)
  function trendColor(data, baseColor) {
    const valid = data.filter(v => v != null)
    if (valid.length < 2) return baseColor
    return valid[valid.length-1] > valid[valid.length-2] ? '#ef4444' : '#16a34a'
  }

  // 데이터 부족 시 fallback 메시지 (오류처럼 보이지 않게)
  //   count=0 → "최근 6개월 데이터 없음" / count=1 → "이번 달 데이터만 입력됨"
  function showFallback(canvas, count, noDataLabel) {
    canvas.style.display = 'none'
    const wrapper = canvas.parentElement
    if (wrapper) wrapper.style.height = 'auto'
    const card = wrapper ? wrapper.parentElement : null
    if (!card || card.querySelector('.spark-nodata')) return
    const box = document.createElement('div')
    box.className = 'spark-nodata'
    if (count <= 0) {
      box.style.cssText = 'font-size:10px;color:#94a3b8;text-align:center;padding:10px 4px;line-height:1.5'
      box.innerHTML = '<i class="fas fa-chart-line" style="opacity:0.3;display:block;font-size:16px;margin-bottom:4px"></i>' + (noDataLabel || '최근 6개월 데이터 없음')
    } else {
      box.style.cssText = 'font-size:9px;color:#64748b;text-align:center;padding:8px 4px;line-height:1.5;background:#f1f5f9;border-radius:6px'
      box.innerHTML = '<span style="font-weight:700;color:#475569">이번 달 데이터만 입력됨</span><br><span style="color:#94a3b8">추이 분석은 2개월 이상<br>입력 후 표시됩니다</span>'
    }
    card.appendChild(box)
  }

  // 공통 Sparkline config
  function sparkCfg(color, labels) {
    return {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: [],
          borderColor: color,
          backgroundColor: color + '18',
          fill: true,
          pointBackgroundColor: color,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBorderWidth: 0,
          borderWidth: 2,
          tension: 0.45,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true, callbacks: {} } },
        scales: { x: { display: false }, y: { display: false } },
        animation: { duration: 500 },
        resizeDelay: 0
      }
    }
  }

  // ① 예산 사용률
  const cvsBudget = document.getElementById('sparkBudget')
  if (cvsBudget) {
    const old = Chart.getChart(cvsBudget); if (old) old.destroy()
    if (budgetCount < 2) { showFallback(cvsBudget, budgetCount, '예산 데이터 없음') }
    else {
      cvsBudget.style.display = ''
      const vals = merged.map(r => r.rate)
      const color = trendColor(vals, '#3b82f6')
      const cfg = sparkCfg(color, labels6)
      cfg.data.datasets[0].data = vals
      cfg.data.datasets[0].spanGaps = true
      cfg.options.scales.y = { display: false, suggestedMin: 0, suggestedMax: 110 }
      cfg.options.plugins.tooltip.callbacks.label = ctx => ctx.parsed.y != null ? ctx.parsed.y.toFixed(1)+'%' : '-'
      // 최신 포인트만 크게
      cfg.data.datasets[0].pointRadius = vals.map((v,i) => i===vals.length-1 ? 4 : 2)
      if (bvEl) bvEl.style.color = color
      new Chart(cvsBudget, cfg)
    }
  }

  // ② 식단가
  const cvsMeal = document.getElementById('sparkMealPrice')
  if (cvsMeal) {
    const old = Chart.getChart(cvsMeal); if (old) old.destroy()
    if (mealCount < 2) { showFallback(cvsMeal, mealCount, '목표 식단가 미설정') }
    else {
      cvsMeal.style.display = ''
      const vals = merged.map(r => r.mealPrice)
      const color = trendColor(vals, '#16a34a')
      const cfg = sparkCfg(color, labels6)
      cfg.data.datasets[0].data = vals
      cfg.data.datasets[0].spanGaps = true
      cfg.data.datasets[0].pointRadius = vals.map((v,i) => i===vals.length-1 ? 4 : 2)
      cfg.options.plugins.tooltip.callbacks.label = ctx => ctx.parsed.y != null ? fmtW(Math.round(ctx.parsed.y)) : '-'
      if (mvEl) mvEl.style.color = color
      new Chart(cvsMeal, cfg)
    }
  }

  // ③ 발주금액
  const cvsOrder = document.getElementById('sparkOrder')
  if (cvsOrder) {
    const old = Chart.getChart(cvsOrder); if (old) old.destroy()
    if (orderCount < 2) { showFallback(cvsOrder, orderCount, '발주 데이터 없음') }
    else {
      cvsOrder.style.display = ''
      const vals = merged.map(r => r.used)
      const color = trendColor(vals, '#d97706')
      const cfg = sparkCfg(color, labels6)
      cfg.data.datasets[0].data = vals
      cfg.data.datasets[0].spanGaps = false
      cfg.data.datasets[0].pointRadius = vals.map((v,i) => i===vals.length-1 ? 4 : 2)
      cfg.options.plugins.tooltip.callbacks.label = ctx => ctx.parsed.y != null ? fmtM(ctx.parsed.y) : '-'
      if (ovEl) ovEl.style.color = color
      new Chart(cvsOrder, cfg)
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// ── ANALYSIS 뷰 — 차트·분석 전용 (테이블 없음) ───────────────────
// ══════════════════════════════════════════════════════════════════
function renderAnalysisView(content, budget, dp, sl, mealStats, vendorOrders, prevMonth, progressPct, repPrice, operPrice, targetPrice, totalMeals, supplyPerMeal, cardTotal, eventTotal, cardVendorTotal) {
  content.innerHTML = `
    <!-- 리스크 배너 (Enhanced) -->
    ${renderExecRiskBannerEnhanced(sl, budget, repPrice, targetPrice)}

    <!-- KPI 카드 -->
    <div class="grid grid-cols-2 gap-4" id="kpiGrid">
      ${kpiCardBudget(budget, progressPct)}
      ${kpiCardMealPrice(repPrice, targetPrice, operPrice)}
      ${kpiCardLabor(sl)}
      ${kpiCardRisk(sl, budget, repPrice, targetPrice)}
      ${kpiCardMeals(mealStats, totalMeals)}
      ${kpiCardScore(State.scoreData)}
    </div>

    <!-- ANALYSIS 전용 뷰 안내 칩 -->
    <div style="display:flex;align-items:center;gap:8px;padding:8px 4px;margin-bottom:-4px">
      <span style="display:inline-flex;align-items:center;gap:5px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:99px;padding:4px 12px;font-size:10px;font-weight:700;letter-spacing:0.04em">
        <i class="fas fa-chart-bar" style="font-size:9px"></i>차트 분석 모드
      </span>
      <span style="font-size:11px;color:#94a3b8">원본 테이블·스케줄은 <strong style="color:#475569">상세</strong> 모드에서 확인</span>
    </div>

    <!-- ① 예산 분석 -->
    ${renderAnalysisBudgetSection(budget, prevMonth, progressPct)}

    <!-- ② 식단가 분석 -->
    ${renderExecDietPriceFlow(repPrice, operPrice, targetPrice, totalMeals, supplyPerMeal, dp, { eventTotal, cardVendorTotal, cardTotal })}

    <!-- ③ 월별 추이 차트 -->
    ${renderAnnualSection()}

    <!-- ④ 업체별 발주 차트 -->
    ${renderAnalysisVendorSection(vendorOrders, budget)}

    <!-- ⑤ 식수 분석 -->
    ${renderAnalysisMealSection(mealStats, vendorOrders, budget)}

    <!-- ⑥ 인건비 현황 -->
    ${renderAnalysisLaborSection(sl)}
  `
  setTimeout(() => {
    initBudgetGaugeChart(progressPct)
    initAnnualChart()
    initVendorChart(vendorOrders)
    initLaborDonutChart(sl)
  }, 100)
}

// ── ANALYSIS 전용: 예산 현황 (게이지 + 수치 요약, 테이블 없음) ───
function renderAnalysisBudgetSection(budget, prevMonth, progressPct) {
  const pct = budget.progress || 0
  const statusColor = progressColor(pct)
  const statusLabel = pct >= 100 ? '예산 초과' : pct >= 85 ? '주의 필요' : '정상'
  const statusBg    = pct >= 100 ? '#fee2e2' : pct >= 85 ? '#fef3c7' : '#dcfce7'
  const statusTxt   = pct >= 100 ? '#dc2626' : pct >= 85 ? '#d97706' : '#16a34a'
  const remaining   = budget.remaining || 0
  const prevPct     = (prevMonth.totalBudget || 0) > 0
                      ? ((prevMonth.totalUsed||0) / prevMonth.totalBudget * 100) : 0
  const trend       = pct - prevPct
  const trendStr    = trend > 0
    ? `<span style="color:#ef4444;font-size:11px;font-weight:700">▲ ${trend.toFixed(1)}%p 증가</span>`
    : trend < 0
    ? `<span style="color:#16a34a;font-size:11px;font-weight:700">▼ ${Math.abs(trend).toFixed(1)}%p 감소</span>`
    : `<span style="color:#94a3b8;font-size:11px">전달 동일</span>`

  return `
  <div class="exec-card" style="padding:18px 18px 16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="font-size:13px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:6px">
        <i class="fas fa-wallet" style="color:#3b82f6;font-size:12px"></i>예산 현황 분석
      </h2>
      <span style="background:${statusBg};color:${statusTxt};font-size:10px;font-weight:700;padding:3px 10px;border-radius:99px">${statusLabel}</span>
    </div>

    <!-- 진행 바 -->
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:6px">
        <span>사용 <strong style="color:#1e293b">${fmtW(budget.totalUsed)}</strong></span>
        <span>예산 <strong style="color:#1e293b">${fmtW(budget.totalBudget)}</strong></span>
      </div>
      <div style="background:#f1f5f9;border-radius:99px;height:10px;overflow:hidden">
        <div style="width:${Math.min(pct,100)}%;height:100%;background:${statusColor};border-radius:99px;transition:width 0.5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;margin-top:4px">
        <span>${pct.toFixed(1)}% 소진</span>
        <span>잔여 ${fmtW(remaining)}</span>
      </div>
    </div>

    <!-- 전달 대비 + 게이지 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
      <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0">
        <div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;margin-bottom:4px">전달 대비</div>
        <div style="font-size:18px;font-weight:800;color:#1e293b;line-height:1.1">${prevPct.toFixed(1)}<span style="font-size:11px;color:#94a3b8">%</span></div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">지난달 소진율 · ${trendStr}</div>
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0">
        <div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;margin-bottom:4px">잔여 예산</div>
        <div style="font-size:15px;font-weight:800;color:${remaining < 0 ? '#dc2626' : '#1e293b'};line-height:1.2">${fmtM(remaining)}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">월 예산 ${fmtM(budget.totalBudget)}</div>
      </div>
    </div>

    <!-- 게이지 차트 (execBudgetGauge) -->
    <div style="margin-top:14px;display:flex;justify-content:center">
      <div style="position:relative;height:90px;width:180px">
        <canvas id="execBudgetGauge"></canvas>
      </div>
    </div>
  </div>`
}

// ── ANALYSIS 전용: 업체별 발주 차트 + TOP3 수치 ──────────────────
function renderAnalysisVendorSection(vendorOrders, budget) {
  if (!vendorOrders || vendorOrders.length === 0) return ''
  const top3 = [...vendorOrders].sort((a,b)=>(b.total_used||0)-(a.total_used||0)).slice(0,3)
  const totalUsed = budget.totalUsed || 0
  const bColors   = ['#3b82f6','#16a34a','#d97706','#9333ea','#ef4444']

  return `
  <div class="exec-card" style="padding:18px 18px 16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="font-size:13px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:6px">
        <i class="fas fa-truck" style="color:#8b5cf6;font-size:12px"></i>업체별 발주 분석
      </h2>
      <span style="font-size:10px;color:#94a3b8">${vendorOrders.length}개 업체</span>
    </div>

    <!-- 도넛 차트 -->
    <div style="height:200px;position:relative;margin-bottom:14px">
      <canvas id="execVendorChart"></canvas>
    </div>

    <!-- TOP3 업체 수치 -->
    <div style="display:flex;flex-direction:column;gap:6px">
      ${top3.map((v,i) => {
        const pct = totalUsed > 0 ? Math.round((v.total_used||0)/totalUsed*100) : 0
        return `<div style="display:flex;align-items:center;gap:8px">
          <span style="width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;flex-shrink:0;background:${bColors[i]}">${i+1}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
              <span style="font-weight:600;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.name}</span>
              <span style="font-weight:700;color:#1e293b;flex-shrink:0;margin-left:6px">${fmtM(v.total_used)}</span>
            </div>
            <div style="background:#f1f5f9;border-radius:99px;height:5px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${bColors[i]};border-radius:99px"></div>
            </div>
          </div>
          <span style="font-size:10px;color:#94a3b8;width:28px;text-align:right;flex-shrink:0">${pct}%</span>
        </div>`
      }).join('')}
    </div>
  </div>`
}

// ── ANALYSIS 전용: 식수 분석 (차트 중심, 상세 테이블 없음) ────────
function renderAnalysisMealSection(mealStats, vendorOrders, budget) {
  const totalMeals = mealStats.totalMeals || 0
  if (totalMeals === 0) return ''

  const supplyTotal = vendorOrders.filter(v=>v.category==='supply').reduce((s,v)=>s+(v.total_used||0),0)
  const costPerMeal = totalMeals > 0 ? Math.round(supplyTotal / totalMeals) : 0
  const targetPrice = budget.targetMealPrice || 0
  const diff        = targetPrice > 0 ? costPerMeal - targetPrice : null
  const diffColor   = diff === null ? '#94a3b8' : diff > 0 ? '#ef4444' : '#16a34a'
  const diffStr     = diff === null ? '목표가 미설정'
                    : diff > 0 ? `목표 대비 +${fmt(diff)}원 초과`
                    : `목표 대비 ${fmt(diff)}원 절감`

  // 식단 유형별 분포 (mealStats에서 필드 추출)
  const breakdown = mealStats.fieldBreakdown || []
  const typeColors = ['#3b82f6','#16a34a','#d97706','#9333ea','#ef4444','#06b6d4','#f43f5e']

  return `
  <div class="exec-card" style="padding:18px 18px 16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="font-size:13px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:6px">
        <i class="fas fa-utensils" style="color:#16a34a;font-size:12px"></i>식수 분석
      </h2>
      <span style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;font-size:10px;font-weight:700;padding:3px 10px;border-radius:99px">
        총 ${fmt(totalMeals)}식
      </span>
    </div>

    <!-- 핵심 지표 2개 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0;text-align:center">
        <div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;margin-bottom:4px">실 식수</div>
        <div style="font-size:22px;font-weight:900;color:#1e293b;line-height:1">${fmt(totalMeals)}<span style="font-size:11px;color:#94a3b8">식</span></div>
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0;text-align:center">
        <div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;margin-bottom:4px">식당 원가/식</div>
        <div style="font-size:22px;font-weight:900;color:${diffColor};line-height:1">${fmt(costPerMeal)}<span style="font-size:11px;color:#94a3b8">원</span></div>
        <div style="font-size:9px;color:${diffColor};margin-top:3px">${diffStr}</div>
      </div>
    </div>

    ${breakdown.length > 0 ? `
    <!-- 유형별 비율 바 -->
    <div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:8px;letter-spacing:0.04em">식단 유형별 구성</div>
    <div style="display:flex;flex-direction:column;gap:5px">
      ${breakdown.slice(0,5).map((f,i) => {
        const pct = totalMeals > 0 ? Math.round(f.thisMonth/totalMeals*100) : 0
        return `<div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;color:#475569;width:70px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.field_name}</span>
          <div style="flex:1;background:#f1f5f9;border-radius:99px;height:6px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${typeColors[i%typeColors.length]};border-radius:99px"></div>
          </div>
          <span style="font-size:10px;font-weight:700;color:#374151;width:32px;text-align:right;flex-shrink:0">${pct}%</span>
        </div>`
      }).join('')}
    </div>` : ''}
  </div>`
}

// ── ANALYSIS 전용: 외부인력 운영 현황 (도넛 차트 + 핵심 수치) ──
function renderAnalysisLaborSection(sl) {
  if (!sl || !sl.laborCost) return ''
  const lc = sl.laborCost || {}
  const ss = sl.staffSummary || {}
  const es = sl.externalSummary || {}
  const showBase = sl.showBaseSalary === true

  // 실제 lc 필드: otCost / dispatchCost / parttimeCost / baseSalary
  const dispCost  = lc.dispatchCost  || 0
  const ptCost    = lc.parttimeCost  || 0
  const otCost    = lc.otCost        || 0
  const baseCost  = showBase ? (lc.baseSalary || 0) : 0
  const extCostTotal = dispCost + ptCost + otCost

  // 차트 항목 (값 있는 것만)
  const items = [
    ...(showBase && baseCost > 0 ? [{ label:'기본급',  value: baseCost,  color:'#818cf8' }] : []),
    ...(otCost   > 0 ? [{ label:'OT수당',  value: otCost,   color:'#fbbf24' }] : []),
    ...(dispCost > 0 ? [{ label:'파출비',  value: dispCost, color:'#fb923c' }] : []),
    ...(ptCost   > 0 ? [{ label:'알바비',  value: ptCost,   color:'#facc15' }] : []),
  ]

  const displayTotal = (lc.total || extCostTotal) || 1

  // 파출/알바 투입일 (externalSummary 기준 — 실제 데이터 소스)
  const dispDays = es.dispatchDays  || 0
  const ptDays   = es.parttimeDays  || 0
  const extDaysTotal = dispDays + ptDays

  // └ 외부인력 투입 구성 (투입일 기준) : 기존엔 staff count 대비로 계산해 항상 0%로 표시되던 문제를 수정
  const hasExtDays  = extDaysTotal > 0
  const dispRatio   = hasExtDays ? Math.round((dispDays / extDaysTotal) * 100) : 0
  const ptRatio     = hasExtDays ? 100 - dispRatio : 0

  // 정규직 인건비(기본급) 대비 외부인력 비용 비중 — 기본급 데이터가 있을 때만 산정 가능
  const baseForRatio = showBase ? (lc.baseSalary || 0) : 0
  const costDependency = baseForRatio > 0
    ? Math.round(((dispCost + ptCost) / (baseForRatio + dispCost + ptCost)) * 100)
    : null
  const depColor = costDependency != null
    ? (costDependency >= 40 ? '#ef4444' : costDependency >= 25 ? '#f59e0b' : '#16a34a')
    : '#94a3b8'

  return `
  <div class="exec-card" style="padding:18px 18px 16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="font-size:13px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:6px">
        <i class="fas fa-user-clock" style="color:#d97706;font-size:12px"></i>외부인력 운영 현황
      </h2>
      <span style="font-size:10px;color:#94a3b8">투입 ${extDaysTotal}일</span>
    </div>

    ${items.length > 0 ? `
    <!-- 도넛 차트 (execLaborDonutChart — initLaborDonutChart와 id 일치) -->
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
      <div style="position:relative;height:100px;width:100px;flex-shrink:0">
        <canvas id="execLaborDonutChart"></canvas>
      </div>
      <!-- 범례 -->
      <div style="flex:1;display:flex;flex-direction:column;gap:5px">
        ${items.map(x => `
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:5px">
            <span style="width:8px;height:8px;border-radius:50%;background:${x.color};flex-shrink:0"></span>
            <span style="font-size:10px;color:#475569">${x.label}</span>
          </div>
          <span style="font-size:10px;font-weight:700;color:#1e293b">${fmtM(x.value)}</span>
        </div>`).join('')}
        <div style="border-top:1px solid #e2e8f0;padding-top:5px;margin-top:2px;display:flex;justify-content:space-between">
          <span style="font-size:10px;font-weight:700;color:#475569">외부인력 비용</span>
          <span style="font-size:11px;font-weight:800;color:#1e293b">${fmtM(extCostTotal)}</span>
        </div>
      </div>
    </div>` : `
    <div style="text-align:center;padding:20px 0;color:#94a3b8;font-size:12px">
      <i class="fas fa-chart-pie" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.3"></i>
      외부인력 비용 데이터 없음
    </div>`}

    <!-- 외부인력 투입 현황 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div style="background:#fff7ed;border-radius:9px;padding:9px 11px;border:1px solid #fed7aa">
        <div style="font-size:9px;font-weight:700;color:#c2410c;letter-spacing:0.05em;margin-bottom:3px">파출 투입일</div>
        <div style="font-size:18px;font-weight:800;color:#ea580c;line-height:1">${dispDays}<span style="font-size:10px;color:#94a3b8">일</span></div>
        <div style="font-size:9px;color:#9a3412;margin-top:2px">${fmtM(dispCost)}</div>
      </div>
      <div style="background:#fefce8;border-radius:9px;padding:9px 11px;border:1px solid #fde68a">
        <div style="font-size:9px;font-weight:700;color:#a16207;letter-spacing:0.05em;margin-bottom:3px">알바 투입일</div>
        <div style="font-size:18px;font-weight:800;color:#d97706;line-height:1">${ptDays}<span style="font-size:10px;color:#94a3b8">일</span></div>
        <div style="font-size:9px;color:#92400e;margin-top:2px">${fmtM(ptCost)}</div>
      </div>
    </div>

    <!-- 외부인력 투입 구성 (투입일 기준) -->
    <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:10px;font-weight:600;color:#64748b">외부인력 투입 구성</span>
        <span style="font-size:13px;font-weight:800;color:#ea580c">총 ${extDaysTotal}일</span>
      </div>
      ${hasExtDays ? `
      <div style="display:flex;background:#e2e8f0;border-radius:99px;height:8px;overflow:hidden">
        <div style="width:${dispRatio}%;height:100%;background:#fb923c"></div>
        <div style="width:${ptRatio}%;height:100%;background:#facc15"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;margin-top:5px">
        <span style="color:#c2410c;font-weight:600"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#fb923c;margin-right:3px"></span>파출 ${dispDays}일 (${dispRatio}%)</span>
        <span style="color:#a16207;font-weight:600"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#facc15;margin-right:3px"></span>알바 ${ptDays}일 (${ptRatio}%)</span>
      </div>` : `
      <div style="font-size:10px;color:#94a3b8;text-align:center;padding:6px 0">외부인력 투입 내역 없음</div>`}
      <div style="border-top:1px dashed #e2e8f0;margin-top:9px;padding-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:10px;font-weight:600;color:#64748b">정규직 대비 외부인력 비용</span>
          ${costDependency != null
            ? `<span style="font-size:13px;font-weight:800;color:${depColor}">${costDependency}%</span>`
            : `<span style="font-size:10px;font-weight:600;color:#94a3b8">산정 불가</span>`}
        </div>
        ${costDependency != null ? `
        <div style="background:#e2e8f0;border-radius:99px;height:6px;overflow:hidden;margin-top:5px">
          <div style="width:${costDependency}%;height:100%;background:${depColor};border-radius:99px;transition:width 0.5s"></div>
        </div>
        ${costDependency >= 40 ? '<div style="font-size:9px;color:#ef4444;font-weight:700;margin-top:4px">⚠ 외부인력 비용 의존도 높음</div>' : ''}` : `
        <div style="font-size:9px;color:#94a3b8;margin-top:4px">정규직 인건비(기본급) 미입력 — 비용 의존도 산정 불가</div>`}
      </div>
    </div>
  </div>`
}


// ══════════════════════════════════════════════════════════════════
// ── DETAIL 뷰 — 원본 검증용 (테이블·스케줄·CSV 전용) ─────────────
// ══════════════════════════════════════════════════════════════════
function renderDetailView(content, budget, dp, sl, mealStats, vendorOrders, cardExpenses, transactions, schedules, catOrders, prevMonth, progressPct, repPrice, operPrice, targetPrice, totalMeals, supplyPerMeal, cardTotal, eventTotal, cardVendorTotal) {
  const yStr = String(State.year)
  const mStr = String(State.month).padStart(2,'0')

  content.innerHTML = `
    <!-- DETAIL 전용 헤더 -->
    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:14px;padding:14px 18px;margin-bottom:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:32px;height:32px;background:rgba(255,255,255,0.1);border-radius:9px;display:flex;align-items:center;justify-content:center">
            <i class="fas fa-database" style="color:#93c5fd;font-size:13px"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:800;color:#f8fafc">원본 데이터 검증</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:1px">${State.year}년 ${mStr}월 · 발주·카드·스케줄·근무 원본 확인</div>
          </div>
        </div>
        <!-- CSV 다운로드 버튼 그룹 -->
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="csvBtn-budget" onclick="execDownloadCSV('budget')"
            style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.3);border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;transition:background 0.15s"
            onmouseover="this.style.background='rgba(59,130,246,0.25)'" onmouseout="this.style.background='rgba(59,130,246,0.15)'">
            <i class="fas fa-download" style="font-size:9px"></i>예산 CSV
          </button>
          <button id="csvBtn-vendors" onclick="execDownloadCSV('vendors')"
            style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:rgba(139,92,246,0.15);color:#c4b5fd;border:1px solid rgba(139,92,246,0.3);border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;transition:background 0.15s"
            onmouseover="this.style.background='rgba(139,92,246,0.25)'" onmouseout="this.style.background='rgba(139,92,246,0.15)'">
            <i class="fas fa-download" style="font-size:9px"></i>발주 CSV
          </button>
          <button id="csvBtn-labor" onclick="execDownloadCSV('labor')"
            style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:rgba(245,158,11,0.15);color:#fcd34d;border:1px solid rgba(245,158,11,0.3);border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;transition:background 0.15s"
            onmouseover="this.style.background='rgba(245,158,11,0.25)'" onmouseout="this.style.background='rgba(245,158,11,0.15)'">
            <i class="fas fa-download" style="font-size:9px"></i>인건비 CSV
          </button>
          <button id="csvBtn-card" onclick="execDownloadCSV('card')"
            style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:rgba(16,185,129,0.15);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3);border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;transition:background 0.15s"
            onmouseover="this.style.background='rgba(16,185,129,0.25)'" onmouseout="this.style.background='rgba(16,185,129,0.15)'">
            <i class="fas fa-download" style="font-size:9px"></i>카드 CSV
          </button>
        </div>
      </div>
    </div>

    <!-- 원본 데이터 탭 네비게이션 -->
    <div class="exec-card p-0 overflow-hidden">
      <div style="display:flex;border-bottom:1px solid #f1f5f9;overflow-x:auto;background:#fafafa" id="execTabBar">
        ${[
          {t:'vendors',     label:'업체별 발주',   icon:'fa-truck'},
          {t:'meals',       label:'식수 현황',     icon:'fa-utensils'},
          {t:'card',        label:'법인카드',       icon:'fa-credit-card'},
          {t:'transactions',label:'지출결의서',     icon:'fa-file-invoice'},
          {t:'schedule',    label:'납품 스케줄',    icon:'fa-calendar-alt'},
          {t:'staffsched',  label:'근무표',         icon:'fa-id-badge'},
          {t:'overview',    label:'종합 현황',      icon:'fa-chart-pie'},
        ].map(({t, label, icon}) => `
          <button onclick="execSwitchTab('${t}')" id="execTab-${t}"
            style="flex-shrink:0;display:flex;align-items:center;gap:5px;padding:10px 14px;font-size:12px;font-weight:600;white-space:nowrap;border:none;background:transparent;cursor:pointer;border-bottom:2px solid ${State.activeTab===t?'#3b82f6':'transparent'};color:${State.activeTab===t?'#1d4ed8':'#6b7280'};transition:all 0.15s"
            onmouseover="if('${t}'!==State.activeTab)this.style.color='#374151'"
            onmouseout="if('${t}'!==State.activeTab)this.style.color='#6b7280'">
            <i class="fas ${icon}" style="font-size:10px"></i>${label}
          </button>`
        ).join('')}
      </div>
      <div style="padding:16px 16px 20px" id="execTabContent">
        ${renderTabContent(State.activeTab, vendorOrders, mealStats, cardExpenses, transactions, schedules, catOrders, budget)}
      </div>
    </div>

    <!-- 인력 & 인건비 상세 -->
    ${renderExecStaffLaborSection(sl)}
  `
  // DETAIL은 탭 콘텐츠 차트만 초기화 (연간 차트·게이지 없음)
  setTimeout(() => {
    initLaborDonutChart(sl)
  }, 100)
}


// ══════════════════════════════════════════════════════════════════
// ── KPI 카드 6종 (병원장 Executive Dashboard — 정돈된 고급 UX) ────
// ══════════════════════════════════════════════════════════════════

// 공통: 카드 컨테이너 래퍼
function _kpiWrap(borderColor, onclick, children) {
  return `<div class="kpi-card cursor-pointer" onclick="${onclick}"
    style="border-top:3px solid ${borderColor};padding:14px 16px 12px;position:relative;overflow:hidden">
    ${children}
  </div>`
}

// 공통: 아이콘 + 카테고리 헤더
function _kpiHeader(iconClass, bgGrad, category) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div style="width:32px;height:32px;border-radius:9px;background:${bgGrad};display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i class="fas ${iconClass}" style="color:#fff;font-size:12px"></i>
    </div>
    <span style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase">${category}</span>
  </div>`
}

// ① 예산 상태 카드
function kpiCardBudget(budget, progressPct) {
  const pct = progressPct || 0
  const level = pct >= 95 ? 'risk' : pct >= 85 ? 'warn' : 'ok'
  const stateLabel = pct >= 100 ? '예산 초과' : pct >= 95 ? '예산 위험' : pct >= 85 ? '예산 주의' : '예산 정상'
  const stateEmoji = pct >= 95 ? '🔴' : pct >= 85 ? '🟡' : '🟢'
  const remaining  = (budget.totalBudget||0) - (budget.totalUsed||0)
  const remText    = remaining < 0 ? `초과 ${fmtM(Math.abs(remaining))}` : `잔여 ${fmtM(remaining)}`
  const c = level==='ok' ? {b:'#16a34a',g:'linear-gradient(135deg,#166534,#16a34a)',r:'#f0fdf4'}
          : level==='warn' ? {b:'#b45309',g:'linear-gradient(135deg,#92400e,#d97706)',r:'#fffbeb'}
          : {b:'#dc2626',g:'linear-gradient(135deg,#991b1b,#ef4444)',r:'#fff5f5'}
  return _kpiWrap(c.b, "openModal('budget')", `
    ${_kpiHeader('fa-wallet', c.g, '예산 상태')}
    <div style="font-size:13px;font-weight:800;color:${c.b};margin-bottom:6px;line-height:1">${stateEmoji} ${stateLabel}</div>
    <div style="font-size:26px;font-weight:900;color:#0f172a;line-height:1;letter-spacing:-0.5px">${pct.toFixed(1)}<span style="font-size:13px;font-weight:600;color:#94a3b8"> %</span></div>
    <div style="height:4px;border-radius:4px;background:#e2e8f0;margin:8px 0 6px;overflow:hidden">
      <div style="height:100%;border-radius:4px;background:${c.b};width:${Math.min(pct,100)}%;transition:width 0.8s ease"></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:${remaining<0?'#dc2626':remaining<(budget.totalBudget||0)*0.1?'#b45309':'#16a34a'}">${remText}</div>
  `)
}

// ② 식단가 상태 카드
function kpiCardMealPrice(repPrice, targetPrice, operPrice) {
  let level = 'ok', stateLabel = '식단가 정상', stateEmoji = '🟢'
  let diffText = '', diffColor = '#16a34a'
  if (targetPrice > 0 && repPrice > 0) {
    const diff     = repPrice - targetPrice
    const overRate = (diff / targetPrice) * 100
    if (overRate > 5)      { level='risk'; stateLabel='식단가 위험'; stateEmoji='🔴' }
    else if (overRate > 0) { level='warn'; stateLabel='식단가 주의'; stateEmoji='🟡' }
    const sign  = diff > 0 ? '+' : ''
    diffText  = `목표 대비 ${sign}${fmtW(Math.round(diff))}`
    diffColor = diff > 0 ? '#dc2626' : '#16a34a'
  } else if (repPrice > 0) {
    diffText = '목표 미설정'; diffColor = '#94a3b8'
  } else {
    stateLabel = '데이터 없음'; stateEmoji = '⚪'
  }
  const c = level==='ok' ? {b:'#16a34a',g:'linear-gradient(135deg,#166534,#16a34a)'}
          : level==='warn' ? {b:'#b45309',g:'linear-gradient(135deg,#92400e,#d97706)'}
          : {b:'#dc2626',g:'linear-gradient(135deg,#991b1b,#ef4444)'}
  return _kpiWrap(c.b, "openModal('mealPrice')", `
    ${_kpiHeader('fa-utensils', c.g, '식단가')}
    <div style="font-size:13px;font-weight:800;color:${c.b};margin-bottom:6px;line-height:1">${stateEmoji} ${stateLabel}</div>
    <div style="font-size:24px;font-weight:900;color:#0f172a;line-height:1;letter-spacing:-0.5px">${repPrice>0?fmtW(repPrice):'—'}</div>
    <div style="font-size:11px;font-weight:600;color:${diffColor};margin-top:7px">${diffText}</div>
  `)
}

// ③ 인력 안정도 카드
function kpiCardLabor(sl) {
  if (!sl || !sl.staffSummary) {
    return _kpiWrap('#cbd5e1', "openModal('labor')", `
      ${_kpiHeader('fa-user-friends', 'linear-gradient(135deg,#475569,#94a3b8)', '인력 안정도')}
      <div style="font-size:13px;font-weight:800;color:#94a3b8;margin-bottom:6px">⚪ 데이터 없음</div>
      <div style="font-size:11px;color:#cbd5e1">인력 정보 미입력</div>
    `)
  }
  const ext          = sl.externalSummary || {}
  const dispatchDays = ext.dispatchDays   || 0
  let extRatio = -1
  if (State.scoreData?.meta?.externalRatio !== undefined) extRatio = State.scoreData.meta.externalRatio
  const level = extRatio >= 60 || dispatchDays >= 30 ? 'risk' : extRatio >= 30 ? 'warn' : 'ok'
  const stateEmoji = level==='risk'?'🔴':level==='warn'?'🟡':'🟢'
  const stateLabel = level==='risk'?'인력 위험':level==='warn'?'인력 주의':'인력 안정'
  const c = level==='ok' ? {b:'#4f46e5',g:'linear-gradient(135deg,#4338ca,#4f46e5)'}
          : level==='warn' ? {b:'#b45309',g:'linear-gradient(135deg,#92400e,#d97706)'}
          : {b:'#dc2626',g:'linear-gradient(135deg,#991b1b,#ef4444)'}
  const sub = extRatio >= 0 ? `외부인력 ${extRatio.toFixed(0)}%` : `파출 ${dispatchDays}회`
  return _kpiWrap(c.b, "openModal('labor')", `
    ${_kpiHeader('fa-user-friends', c.g, '인력 안정도')}
    <div style="font-size:13px;font-weight:800;color:${c.b};margin-bottom:6px;line-height:1">${stateEmoji} ${stateLabel}</div>
    <div style="font-size:24px;font-weight:900;color:#0f172a;line-height:1;letter-spacing:-0.5px">파출 ${dispatchDays}<span style="font-size:13px;font-weight:600;color:#94a3b8">회</span></div>
    <div style="font-size:11px;font-weight:600;color:${c.b};margin-top:7px">${sub}</div>
  `)
}

// ④ 운영 리스크 카드
function kpiCardRisk(sl, budget, repPrice, targetPrice) {
  const risks       = buildRiskList(sl, budget, repPrice, targetPrice)
  const dangerCount = risks.filter(r=>r.level==='risk').length
  const warnCount   = risks.filter(r=>r.level==='warn').length
  const topLevel    = dangerCount > 0 ? 'risk' : warnCount > 0 ? 'warn' : 'ok'
  const stateEmoji  = topLevel==='risk'?'🔴':topLevel==='warn'?'🟡':'🟢'
  const stateLabel  = topLevel==='risk'?`위험 ${dangerCount}건`:topLevel==='warn'?`주의 ${warnCount}건`:'이상 없음'
  const c = topLevel==='ok' ? {b:'#16a34a',g:'linear-gradient(135deg,#166534,#16a34a)'}
          : topLevel==='warn' ? {b:'#b45309',g:'linear-gradient(135deg,#92400e,#d97706)'}
          : {b:'#dc2626',g:'linear-gradient(135deg,#991b1b,#ef4444)'}
  const riskRows = risks.length === 0
    ? `<div style="font-size:11px;font-weight:600;color:#16a34a">현재 리스크 없음</div>`
    : risks.slice(0,2).map(r=>`<div style="font-size:10px;color:${r.level==='risk'?'#dc2626':'#b45309'};font-weight:500;margin-bottom:1px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">· ${r.msg}</div>`).join('')
      + (risks.length>2 ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px">+${risks.length-2}건 더 →</div>` : '')
  return _kpiWrap(c.b, "openModal('risk')", `
    ${_kpiHeader(topLevel==='ok'?'fa-shield-alt':'fa-exclamation-triangle', c.g, '운영 리스크')}
    <div style="font-size:13px;font-weight:800;color:${c.b};margin-bottom:6px;line-height:1">${stateEmoji} ${stateLabel}</div>
    <div style="min-height:32px">${riskRows}</div>
  `)
}

// buildRiskList (공통 — KPI 카드 + 배너에서 공유)
function buildRiskList(sl, budget, repPrice, targetPrice) {
  const risks = []
  const pct = budget.progress || 0
  if      (pct >= 95) risks.push({ level:'risk', msg:`예산 사용률 ${pct.toFixed(1)}%` })
  else if (pct >= 85) risks.push({ level:'warn', msg:`예산 사용률 ${pct.toFixed(1)}%` })
  if (targetPrice > 0 && repPrice > targetPrice) {
    const over = Math.round(((repPrice-targetPrice)/targetPrice)*100)
    risks.push({ level: over>5?'risk':'warn', msg:`식단가 목표 +${over}% 초과` })
  }
  if (sl?.externalSummary) {
    const extRatio = State.scoreData?.meta?.externalRatio ?? -1
    if      (extRatio >= 60) risks.push({ level:'risk', msg:`외부인력 비중 ${extRatio.toFixed(0)}%` })
    else if (extRatio >= 30) risks.push({ level:'warn', msg:`외부인력 비중 ${extRatio.toFixed(0)}%` })
    const d = sl.externalSummary.dispatchDays || 0
    if (d >= 30) risks.push({ level:'risk', msg:`파출 ${d}회` })
  }
  ;(sl?.warnings||[]).forEach(w => risks.push({ level:w.level||'warn', msg:w.message }))
  return risks
}

// ⑤ 식수 현황 카드
function kpiCardMeals(mealStats, totalMeals) {
  const total        = totalMeals || 0
  const days         = mealStats.daysEntered || 0
  const avg          = days > 0 ? Math.round(total / days) : 0
  const staff        = mealStats.total_staff    || 0
  const guardian     = mealStats.total_guardian || 0
  const patientMeals = Math.max(0, total - staff - guardian)
  const patientPct   = total > 0 ? ((patientMeals/total)*100).toFixed(0) : 0
  const staffPct     = total > 0 ? ((staff/total)*100).toFixed(0) : 0
  const hasData      = total > 0
  const c = { b:'#b45309', g:'linear-gradient(135deg,#92400e,#d97706)' }
  return _kpiWrap(c.b, "openModal('meals')", `
    ${_kpiHeader('fa-utensils', c.g, '식수 현황')}
    <div style="font-size:13px;font-weight:800;color:${c.b};margin-bottom:6px;line-height:1">${hasData?'🍽 식수 입력됨':'⚪ 미입력'}</div>
    <div style="font-size:26px;font-weight:900;color:#0f172a;line-height:1;letter-spacing:-0.5px">${fmt(total)}<span style="font-size:13px;font-weight:600;color:#94a3b8">식</span></div>
    <div style="font-size:11px;color:#64748b;margin-top:7px">일평균 ${fmt(avg)}식 · 환자 ${patientPct}% · 직원 ${staffPct}%</div>
  `)
}

// ⑥ 운영 종합 점수 카드
function kpiCardScore(scoreData) {
  if (!scoreData) {
    return _kpiWrap('#e2e8f0', "openModal('score')", `
      ${_kpiHeader('fa-star', 'linear-gradient(135deg,#475569,#94a3b8)', '종합 점수')}
      <div style="font-size:13px;font-weight:800;color:#94a3b8;margin-bottom:6px">⚪ 집계 준비 중</div>
      <div style="font-size:11px;color:#cbd5e1">데이터 불러오는 중...</div>
    `)
  }
  if (!scoreData.available) {
    return _kpiWrap('#e2e8f0', "openModal('score')", `
      ${_kpiHeader('fa-star', 'linear-gradient(135deg,#475569,#94a3b8)', '종합 점수')}
      <div style="font-size:13px;font-weight:800;color:#94a3b8;margin-bottom:6px">⚪ 산정 준비 중</div>
      <div style="font-size:11px;color:#94a3b8;line-height:1.5">데이터 축적 후 자동 산정됩니다</div>
    `)
  }
  const score      = scoreData.totalScore || 0
  const grade      = scoreData.grade      || '-'
  const gradeEmoji = grade==='A'?'🟢':grade==='B'?'🔵':grade==='C'?'🟡':'🔴'
  const gradeLabel = grade==='A'?'우수':grade==='B'?'양호':grade==='C'?'보통':'주의 필요'
  const c = grade==='A' ? {b:'#16a34a',g:'linear-gradient(135deg,#166534,#16a34a)'}
          : grade==='B' ? {b:'#2563eb',g:'linear-gradient(135deg,#1e3a8a,#2563eb)'}
          : grade==='C' ? {b:'#b45309',g:'linear-gradient(135deg,#92400e,#d97706)'}
          : {b:'#dc2626',g:'linear-gradient(135deg,#991b1b,#ef4444)'}
  const firstRec = (scoreData.recommendations||[])[0] || ''
  return _kpiWrap(c.b, "openModal('score')", `
    ${_kpiHeader('fa-star', c.g, '종합 점수')}
    <div style="font-size:13px;font-weight:800;color:${c.b};margin-bottom:6px;line-height:1">${gradeEmoji} ${grade}등급 — ${gradeLabel}</div>
    <div style="font-size:26px;font-weight:900;color:#0f172a;line-height:1;letter-spacing:-0.5px">${score}<span style="font-size:13px;font-weight:600;color:#94a3b8"> / 100</span></div>
    ${firstRec ? `<div style="font-size:10px;color:#64748b;margin-top:7px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${firstRec}</div>` : ''}
  `)
}

// 업체별 차트 섹션 (ANALYSIS용)
function renderVendorChartSection(vendorOrders) {
  if (!vendorOrders || vendorOrders.length === 0) return ''
  return `
  <div class="exec-card p-5">
    <h3 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
      <i class="fas fa-truck text-blue-500"></i> 업체별 발주 현황
    </h3>
    <div style="height:220px"><canvas id="execVendorChart"></canvas></div>
  </div>`
}

// ── 식단가 KPI 카드 (대표 식단가 강조 버전 — DETAIL 탭용 유지) ──────────────────────────
function kpiCardDietPrice(repPrice, targetPrice, operPrice, prevMealPrice) {
  const opDiff = operPrice - repPrice
  const repDiff = repPrice - targetPrice
  const prevDiff = repPrice - prevMealPrice
  const repColor = targetPrice > 0 ? (repDiff > 0 ? '#dc2626' : '#16a34a') : '#1e40af'
  const repBadgeBg = targetPrice > 0 ? (repDiff > 0 ? '#fee2e2' : '#dcfce7') : '#eff6ff'
  const prevSign = prevDiff > 0 ? '+' : ''
  return `
  <div class="kpi-card p-4 md:p-5" style="border:2px solid #1e40af20">
    <div class="flex items-start justify-between mb-2">
      <div class="w-10 h-10 rounded-xl gradient-green flex items-center justify-center flex-shrink-0">
        <i class="fas fa-utensils text-white text-sm"></i>
      </div>
      <span style="font-size:10px;font-weight:700;background:#eff6ff;color:#1e40af;padding:2px 7px;border-radius:99px;border:1px solid #bfdbfe">★ 기준</span>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:2px">대표 식단가 (★기준)</div>
    <div style="font-size:20px;font-weight:800;color:${repColor};line-height:1.2">${fmtW(repPrice)}</div>
    <div style="font-size:10px;margin-top:3px">
      ${targetPrice > 0 ? `<span style="color:#9ca3af">목표 ${fmtW(targetPrice)}</span>
      <span style="margin-left:4px;font-weight:700;color:${repColor}">${repDiff > 0 ? '+' : ''}${fmtW(repDiff)}</span>` : `<span style="color:#9ca3af">목표 미설정</span>`}
    </div>
    ${opDiff !== 0 ? `<div style="font-size:10px;color:#7c3aed;margin-top:4px;padding:2px 6px;background:#f5f3ff;border-radius:6px;display:inline-block">
      운영비 반영 ${opDiff > 0 ? '+' : ''}${fmtW(opDiff)} → ${fmtW(operPrice)}
    </div>` : ''}
    ${prevMealPrice > 0 ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px">전월비 ${prevSign}${fmtW(prevDiff)}</div>` : ''}
  </div>`
}

// ── 식단가 구조 흐름 섹션 (executive 전용 inline 구현) ──────────────
// supplyPerMeal: 소모품만 (운영비 원인 - 대표식단가에 미포함)
// extra: { eventTotal, cardVendorTotal, cardTotal } - 참고 표시용
function renderExecDietPriceFlow(repPrice, operPrice, targetPrice, totalMeals, supplyPerMeal, dp, extra) {
  const eventTotal = extra?.eventTotal || 0
  const cardVendorTotal = extra?.cardVendorTotal || 0
  const cardTotal = extra?.cardTotal || 0
  if (!repPrice && !operPrice) return ''
  const opDiff = operPrice - repPrice
  const opSign = opDiff > 0 ? '+' : ''
  const opColor = opDiff > 0 ? '#7c3aed' : '#16a34a'

  // 목표 대비 판단
  const repDiff = repPrice - targetPrice
  const repIsOver = targetPrice > 0 && repDiff > 0
  const repIsWarn = targetPrice > 0 && !repIsOver && repPrice >= targetPrice * 0.9
  const repColor = repIsOver ? '#dc2626' : repIsWarn ? '#d97706' : '#16a34a'
  const repBgColor = repIsOver ? '#fff1f2' : repIsWarn ? '#fffbeb' : '#f0fdf4'
  const repBorderColor = repIsOver ? '#fca5a5' : repIsWarn ? '#fde68a' : '#86efac'

  // 해석 문장
  let interpMsg = ''
  if (opDiff !== 0) {
    // 원인: 소모품만 (supplyPerMeal) — 이벤트/카드는 대표식단가에 포함된 금액이므로 제외
    const causes = []
    if (supplyPerMeal > 0) causes.push(`소모품 +${fmtW(supplyPerMeal)}`)
    const causeStr = causes.length > 0 ? ` (${causes.join(' · ')})` : ''
    interpMsg = `소모품 발주가 운영반영 식단가에 포함되어 대표 식단가 대비 <strong style="color:${opColor}">${opSign}${fmtW(opDiff)}</strong> ${opDiff > 0 ? '높습니다' : '낮습니다'}${causeStr}.`
  }
  if (targetPrice > 0) {
    const repDiffAbs = Math.abs(repDiff)
    if (repIsOver) {
      interpMsg += ` <span style="color:#dc2626">⚠️ 대표 식단가가 목표 대비 +${fmtW(repDiffAbs)} 초과</span> — 식재료비 절감 검토가 필요합니다.`
    } else if (repIsWarn) {
      interpMsg += ` <span style="color:#d97706">⚠ 대표 식단가가 목표에 근접 (여유 ${fmtW(repDiffAbs)})</span>`
    } else {
      interpMsg += ` <span style="color:#16a34a">✅ 대표 식단가가 목표 범위 내에 있습니다.</span>`
    }
  }

  // 원인 분해 행 (소모품만 표시)
  const causeRows = []
  if (supplyPerMeal > 0) causeRows.push({ label: '소모품/세제', val: supplyPerMeal, color: '#f59e0b', icon: 'fa-box' })

  const patPrice = dp.patient || 0

  return `
  <div class="exec-card p-4 md:p-5">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="font-size:14px;font-weight:700;color:#1f2937;display:flex;align-items:center;gap:6px">
        <i class="fas fa-chart-bar" style="color:#1e40af"></i>
        식단가 구조 (★ 기준 중심)
      </h2>
      <span style="font-size:10px;color:#6b7280;background:#f9fafb;padding:2px 8px;border-radius:6px">왜 값이 다른가?</span>
    </div>

    <!-- 흐름: 대표 → 운영비 영향 → 운영반영 -->
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:${causeRows.length > 0 || patPrice > 0 ? '12px' : '0'}">

      <!-- 대표 식단가 (기준, 강조) -->
      <div style="flex:1;min-width:120px;background:${repBgColor};border:2px solid ${repBorderColor};border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:10px;font-weight:700;color:#1e40af;margin-bottom:4px">
          ★ 대표 식단가 <span style="background:#eff6ff;color:#1e40af;padding:1px 5px;border-radius:4px;font-size:9px">기준</span>
        </div>
        <div style="font-size:20px;font-weight:800;color:#1e40af;line-height:1">${fmtW(repPrice)}</div>
        <div style="font-size:10px;color:#6b7280;margin-top:3px">식재료비 기준</div>
        ${targetPrice > 0 ? `<div style="font-size:10px;margin-top:4px;font-weight:700;color:${repColor}">${repIsOver ? '▲ 목표 초과' : '✓ 목표 범위'} (${repIsOver?'+':''}${fmtW(repDiff)})</div>` : ''}
      </div>

      <!-- 화살표 -->
      ${opDiff !== 0 ? `
      <div style="text-align:center;flex-shrink:0;padding:4px">
        <div style="font-size:16px;color:${opColor}">→</div>
        <div style="font-size:11px;font-weight:700;color:${opColor}">${opSign}${fmtW(opDiff)}</div>
        <div style="font-size:9px;color:#9ca3af">운영비 영향</div>
      </div>

      <!-- 운영반영 식단가 (보조, 흐릿하게) -->
      <div style="flex:1;min-width:100px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:10px;padding:10px;text-align:center;opacity:0.88">
        <div style="font-size:9px;font-weight:700;color:#7c3aed;margin-bottom:3px">운영반영 식단가 <span style="background:#f5f3ff;color:#7c3aed;padding:1px 4px;border-radius:4px;font-size:8px">참고</span></div>
        <div style="font-size:16px;font-weight:700;color:#7c3aed">${fmtW(operPrice)}</div>
        <div style="font-size:9px;color:#a78bfa;margin-top:2px">전체 운영비 포함</div>
      </div>` : ''}
    </div>

    <!-- 원인 분해 (소모품) -->
    ${causeRows.length > 0 ? `
    <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:10px;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:7px;display:flex;align-items:center;gap:4px">
        <i class="fas fa-sitemap" style="color:#d97706;font-size:10px"></i>
        운영비 영향 원인 분해
        <span style="font-size:9px;color:#d97706;font-weight:700">(1식당 +${fmtW(Math.abs(opDiff))})</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        ${causeRows.map(r => `
        <div style="background:white;border:1px solid #fcd34d;border-radius:8px;padding:6px 10px;min-width:60px;flex:1;text-align:center">
          <i class="fas ${r.icon}" style="color:${r.color};font-size:11px;margin-bottom:2px;display:block"></i>
          <div style="font-size:9px;color:#78350f;font-weight:700">${r.label}</div>
          <div style="font-size:13px;font-weight:800;color:#92400e">+${fmtW(r.val)}</div>
        </div>`).join('')}
      </div>
      <div style="font-size:9px;color:#92400e;background:#fef9c3;border-radius:5px;padding:4px 8px;border-left:2px solid #fbbf24;line-height:1.6">
        <strong>왜 값이 다른가?</strong> 대표 식단가는 소모품 발주를 제외한 순수 식재료비 기준입니다.
        운영반영 식단가는 소모품을 포함한 전체 발주액 기준으로, 차이 +${fmtW(Math.abs(opDiff))}은 소모품 발주(${fmtW(totalMeals > 0 ? Math.round((extra?.eventTotal||0)+(extra?.cardVendorTotal||0)+(extra?.cardTotal||0)) : 0)}원 별도)에 해당합니다.
      </div>
    </div>` : ''}
    <!-- 이벤트/카드 참고 (대표식단가에 포함) -->
    ${(eventTotal > 0 || cardVendorTotal > 0) ? `
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:8px 10px;margin-bottom:8px">
      <div style="font-size:10px;font-weight:700;color:#0369a1;margin-bottom:5px;display:flex;align-items:center;gap:4px">
        <i class="fas fa-info-circle" style="color:#0284c7;font-size:9px"></i>
        대표식단가 포함 항목 (참고)
        <span style="font-size:9px;color:#0284c7">· 이미 대표식단가에 반영됨</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${eventTotal > 0 ? `<div style="background:white;border:1px solid #bae6fd;border-radius:6px;padding:3px 8px;font-size:10px;color:#0369a1">🎉 이벤트 ${fmtW(eventTotal)}</div>` : ''}
        ${cardVendorTotal > 0 ? `<div style="background:white;border:1px solid #bae6fd;border-radius:6px;padding:3px 8px;font-size:10px;color:#0369a1">💳 카드발주 ${fmtW(cardVendorTotal)}</div>` : ''}
        ${cardTotal > 0 ? `<div style="background:white;border:1px solid #bae6fd;border-radius:6px;padding:3px 8px;font-size:10px;color:#0369a1">💳 법인카드 ${fmtW(cardTotal)}</div>` : ''}
      </div>
    </div>` : ''}

    <!-- 환자 식단가 (분리) -->
    ${patPrice > 0 ? `
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;padding:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <i class="fas fa-user-injured" style="color:#16a34a;font-size:12px"></i>
          <span style="font-size:12px;font-weight:700;color:#15803d">환자 식단가</span>
          <span style="font-size:9px;background:#dcfce7;color:#16a34a;padding:1px 5px;border-radius:4px">환자 전용</span>
        </div>
        <div style="font-size:18px;font-weight:800;color:#16a34a">${fmtW(patPrice)}</div>
      </div>
      <div style="font-size:9px;color:#166534;line-height:1.5">
        소모품 + 이벤트 + 카드 발주 제외 기준 (순수 식재료비 ÷ 전체 식수)
        ${targetPrice > 0 ? `<span style="margin-left:4px;font-weight:700;color:${patPrice > targetPrice ? '#dc2626' : '#059669'}">${patPrice > targetPrice ? '▲ 목표 초과' : '✓ 목표 이내'} (목표 ${fmtW(targetPrice)})</span>` : ''}
      </div>
    </div>` : ''}

    <!-- 해석 문장 -->
    ${interpMsg ? `
    <div style="font-size:11px;color:#374151;background:#f8fafc;border-left:3px solid #1e40af;padding:8px 10px;border-radius:0 8px 8px 0;line-height:1.6">
      ${interpMsg}
    </div>` : ''}
  </div>`
}

// ── KPI 카드 ─────────────────────────────────────────────────────
function kpiCard(icon, label, value, sub, pct, barColor, gradient, extra) {
  return `
  <div class="kpi-card p-4 md:p-5">
    <div class="flex items-start justify-between mb-3">
      <div class="w-10 h-10 rounded-xl ${gradient} flex items-center justify-center flex-shrink-0">
        <i class="fas ${icon} text-white text-sm"></i>
      </div>
      ${extra ? `<span class="text-xs text-gray-400 font-medium">${extra}</span>` : ''}
    </div>
    <div class="text-xl font-bold text-gray-800 leading-tight">${value}</div>
    <div class="text-xs text-gray-500 mt-0.5">${sub}</div>
    ${pct !== null && pct !== undefined ? `
    <div class="mt-3">
      <div class="flex justify-between text-xs text-gray-400 mb-1">
        <span>${label}</span><span>${fmtPct(pct)}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${Math.min(pct,100)}%;background:${barColor}"></div>
      </div>
    </div>` : `<div class="text-xs text-gray-400 mt-2">${label}</div>`}
  </div>`
}

// ── 예산 상세 섹션 ───────────────────────────────────────────────
function renderBudgetSection(budget, prevMonth) {
  const pct = budget.progress || 0
  const statusColor = progressColor(pct)
  const statusLabel = pct >= 100 ? '예산 초과' : pct >= 85 ? '주의 필요' : '정상'
  const statusBg = pct >= 100 ? '#fee2e2' : pct >= 85 ? '#fef3c7' : '#dcfce7'
  const statusTextColor = pct >= 100 ? '#dc2626' : pct >= 85 ? '#d97706' : '#16a34a'
  const remaining = budget.remaining || 0
  const prevUsed = prevMonth.totalUsed || 0
  const prevBudget = prevMonth.totalBudget || 0
  const prevPct = prevBudget > 0 ? (prevUsed / prevBudget * 100) : 0

  return `
  <div class="exec-card p-4 md:p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-gray-800 flex items-center gap-2">
        <i class="fas fa-wallet text-blue-600"></i>
        예산 현황
      </h2>
      <span class="badge" style="background:${statusBg};color:${statusTextColor}">
        ${statusLabel}
      </span>
    </div>
    <div class="mb-4">
      <div class="flex justify-between text-sm mb-2">
        <span class="text-gray-500">사용 <strong class="text-gray-800">${fmtW(budget.totalUsed)}</strong></span>
        <span class="text-gray-500">예산 <strong class="text-gray-800">${fmtW(budget.totalBudget)}</strong></span>
      </div>
      <div class="progress-bar" style="height:12px">
        <div class="progress-fill" style="width:${Math.min(pct,100)}%;background:${statusColor}"></div>
      </div>
      <div class="flex justify-between text-xs mt-1.5">
        <span style="color:${statusColor}" class="font-bold">${fmtPct(pct)} 사용</span>
        <span class="text-gray-400">잔여 <strong class="text-gray-600">${fmtW(remaining)}</strong></span>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div class="bg-gray-50 rounded-xl p-3 text-center">
        <div class="text-xs text-gray-400 mb-1">총 예산</div>
        <div class="font-bold text-gray-800 text-sm">${fmtM(budget.totalBudget)}</div>
      </div>
      <div class="bg-gray-50 rounded-xl p-3 text-center">
        <div class="text-xs text-gray-400 mb-1">사용 금액</div>
        <div class="font-bold text-blue-700 text-sm">${fmtM(budget.totalUsed)}</div>
      </div>
      <div class="bg-gray-50 rounded-xl p-3 text-center">
        <div class="text-xs text-gray-400 mb-1">잔여 예산</div>
        <div class="font-bold ${remaining < 0 ? 'text-red-600' : 'text-green-700'} text-sm">${fmtM(remaining)}</div>
      </div>
      <div class="bg-gray-50 rounded-xl p-3 text-center">
        <div class="text-xs text-gray-400 mb-1">전월 소진율</div>
        <div class="font-bold text-gray-700 text-sm">${fmtPct(prevPct)}</div>
      </div>
    </div>
  </div>`
}

// ── 탭 콘텐츠 ────────────────────────────────────────────────────
window.execSwitchTab = function(tab) {
  State.activeTab = tab
  // 탭 버튼 스타일 동기화 (classList + inline style 모두 처리)
  document.querySelectorAll('[id^="execTab-"]').forEach(el => {
    const t = el.id.replace('execTab-','')
    const isActive = t === tab
    // classList 기반 (ANALYSIS 구 탭 방식 대응)
    el.classList.toggle('tab-active', isActive)
    el.classList.toggle('text-gray-500', !isActive)
    // inline style 기반 (DETAIL 탭 방식 대응)
    if (el.style.borderBottom !== undefined) {
      el.style.borderBottom = isActive ? '2px solid #3b82f6' : '2px solid transparent'
      el.style.color = isActive ? '#1d4ed8' : '#6b7280'
    }
  })
  const d = State.data
  const contentEl = document.getElementById('execTabContent')
  if (!contentEl || !d) return
  contentEl.innerHTML = renderTabContent(tab,
    d.vendorOrders||[], d.mealStats||{}, d.cardExpenses||[],
    d.transactions||[], d.schedules||[], d.catOrders||[], d.budget||{},
    d.mealFieldBreakdown||[], d.prevMonth||{})
  // 차트 재초기화
  if (tab === 'vendors') setTimeout(() => initVendorChart(d.vendorOrders||[]), 100)
  // 인력 근무현황 탭 렌더링
  if (tab === 'staffsched') {
    contentEl.innerHTML = renderExecStaffScheduleTab()
  }
}

function renderTabContent(tab, vendorOrders, mealStats, cardExpenses, transactions, schedules, catOrders, budget, mealFieldBreakdown, prevMonthData) {
  switch(tab) {
    case 'overview': return renderOverviewTab(vendorOrders, mealStats, catOrders, budget, mealFieldBreakdown, prevMonthData)
    case 'vendors': return renderVendorsTab(vendorOrders, budget)
    case 'meals': return renderMealsTab(mealStats, mealFieldBreakdown, prevMonthData)
    case 'card': return renderCardTab(cardExpenses)
    case 'transactions': return renderTransactionsTab(transactions)
    case 'schedule': return renderScheduleTab(schedules)
    case 'staffsched': return renderExecStaffScheduleTab()
    default: return ''
  }
}

// ── 종합 현황 탭 ──────────────────────────────────────────────────
function renderOverviewTab(vendorOrders, mealStats, catOrders, budget, mealFieldBreakdown, prevMonthData) {
  const top5 = [...vendorOrders].sort((a,b) => (b.total_used||0)-(a.total_used||0)).slice(0,5)
  const customFields = mealStats.mealCustomFields || []
  const customTotals = mealStats.customFieldTotals || {}

  return `
  <div class="space-y-5">
    <!-- 업체 TOP5 -->
    <div>
      <h3 class="font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <i class="fas fa-trophy text-amber-500 text-sm"></i>발주 TOP 5 업체
      </h3>
      ${top5.length === 0
        ? '<p class="text-gray-400 text-sm text-center py-4">발주 데이터 없음</p>'
        : `<div class="space-y-2">
          ${top5.map((v,i) => {
            const pct = budget.totalUsed > 0 ? Math.round((v.total_used||0)/budget.totalUsed*100) : 0
            const bColors = ['#3b82f6','#16a34a','#d97706','#9333ea','#ef4444']
            return `<div class="flex items-center gap-3">
              <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style="background:${bColors[i]}">${i+1}</span>
              <div class="flex-1 min-w-0">
                <div class="flex justify-between text-sm mb-1">
                  <span class="font-medium text-gray-700 truncate">${v.name}</span>
                  <span class="text-gray-600 font-semibold flex-shrink-0 ml-2">${fmtM(v.total_used)}</span>
                </div>
                <div class="progress-bar" style="height:6px">
                  <div class="progress-fill" style="width:${pct}%;background:${bColors[i]}"></div>
                </div>
              </div>
              <span class="text-xs text-gray-400 w-10 text-right flex-shrink-0">${pct}%</span>
            </div>`
          }).join('')}
        </div>`}
    </div>

    ${catOrders && catOrders.length > 0 ? `
    <!-- 카테고리별 발주 -->
    <div>
      <h3 class="font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <i class="fas fa-layer-group text-purple-500 text-sm"></i>카테고리별 발주 현황
      </h3>
      <div class="space-y-2">
        ${catOrders.map(c => `
        <div class="flex items-center justify-between py-1.5 border-b border-gray-50">
          <span class="text-sm text-gray-600">${c.category_name}</span>
          <span class="font-semibold text-gray-800 text-sm">${fmtW(c.total)}</span>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- 식수 현황 요약 (분류별 + 전달 대비) -->
    ${(() => {
      const fbd = (mealFieldBreakdown||[]).filter(f => f.thisMonth > 0 || f.prevMonth > 0)
      if (fbd.length === 0 && (mealStats.totalMeals||0) === 0) return ''
      const prevLabel = prevMonthData && prevMonthData.month ? `${prevMonthData.month}월` : '전달'
      const getFieldColor = (key, name) => {
        if (key.startsWith('diet_preset_staff_') || name.includes('직원')) return '#3b82f6'
        if (key.startsWith('diet_preset_nc_') || name.includes('보호자') || name.includes('비급여')) return '#9333ea'
        if (key.startsWith('diet_preset_therapy_') || name.includes('치료식') || name.includes('절제') || name.includes('잔사') || name.includes('요오드')) return '#ea580c'
        if (key.startsWith('cat_') || name.includes('항암') || name.includes('요양') || name.includes('일반')) return '#16a34a'
        return '#6b7280'
      }
      return `
      <div>
        <h3 class="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <i class="fas fa-utensils text-green-500 text-sm"></i>이번 달 식수 요약
          <span class="text-xs font-normal text-gray-400 ml-auto">총 ${fmt(mealStats.totalMeals||0)}식</span>
        </h3>
        ${fbd.length > 0 ? `
        <div class="overflow-hidden rounded-xl border border-gray-100">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 text-gray-600">
                <th class="text-left px-3 py-2 font-semibold text-xs">식단 유형</th>
                <th class="text-right px-3 py-2 font-semibold text-xs">이번달</th>
                <th class="text-right px-3 py-2 font-semibold text-xs">${prevLabel}</th>
                <th class="text-right px-3 py-2 font-semibold text-xs">증감</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              ${fbd.map((f,i) => {
                const color = getFieldColor(f.field_key, f.field_name)
                const unit = f.unit_type === 'ea' ? '개' : '식'
                const diffStr = f.diff > 0 ? `<span class="text-emerald-600 font-semibold text-xs">+${fmt(f.diff)}</span>`
                              : f.diff < 0 ? `<span class="text-red-500 font-semibold text-xs">${fmt(f.diff)}</span>`
                              : `<span class="text-gray-300 text-xs">-</span>`
                const pct = (mealStats.totalMeals||0) > 0 ? Math.round(f.thisMonth/(mealStats.totalMeals||1)*100) : 0
                return `<tr class="${i%2===0?'bg-white':'bg-gray-50/50'}">
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color}"></span>
                      <span class="font-medium text-gray-700">${f.field_name}</span>
                    </div>
                  </td>
                  <td class="text-right px-3 py-2">
                    <span class="font-bold" style="color:${color}">${fmt(f.thisMonth)}${unit}</span>
                    ${pct > 0 ? `<span class="text-xs text-gray-400 ml-1">(${pct}%)</span>` : ''}
                  </td>
                  <td class="text-right px-3 py-2 text-gray-500 text-xs">${f.prevMonth > 0 ? fmt(f.prevMonth)+unit : '-'}</td>
                  <td class="text-right px-3 py-2">${diffStr}</td>
                </tr>`
              }).join('')}
            </tbody>
            <tfoot>
              <tr class="bg-green-50 font-semibold text-green-800">
                <td class="px-3 py-2 text-sm">합계</td>
                <td class="text-right px-3 py-2 text-sm">${fmt(fbd.reduce((s,f)=>s+f.thisMonth,0))}식</td>
                <td class="text-right px-3 py-2 text-xs text-gray-500">${fmt(fbd.reduce((s,f)=>s+f.prevMonth,0))}식</td>
                <td class="text-right px-3 py-2 text-xs">${(()=>{const d=fbd.reduce((s,f)=>s+f.diff,0);return d>0?`<span class="text-emerald-600">+${fmt(d)}</span>`:d<0?`<span class="text-red-500">${fmt(d)}</span>`:`<span class="text-gray-300">-</span>`})()}</td>
              </tr>
            </tfoot>
          </table>
        </div>` : `<p class="text-gray-400 text-sm text-center py-3">이번 달 식수 입력 없음</p>`}
      </div>`
    })()}
  </div>`
}

// ── 업체별 발주 탭 ────────────────────────────────────────────────
function renderVendorsTab(vendorOrders, budget) {
  const totalUsed = budget.totalUsed || 0
  const sorted = [...vendorOrders].sort((a,b) => (b.total_used||0)-(a.total_used||0))
  const catGroups = {}
  sorted.forEach(v => {
    const cat = v.category || '기타'
    if (!catGroups[cat]) catGroups[cat] = []
    catGroups[cat].push(v)
  })

  return `
  <div class="space-y-5">
    <!-- 업체별 파이 차트 -->
    <div style="height:220px;position:relative">
      <canvas id="vendorPieChart"></canvas>
    </div>

    <!-- 카테고리별 그룹 -->
    ${Object.entries(catGroups).map(([cat, vendors]) => {
      const catTotal = vendors.reduce((s,v) => s + (v.total_used||0), 0)
      return `
      <div>
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-semibold text-gray-700 text-sm">${cat}</h4>
          <span class="text-sm font-bold text-gray-600">${fmtW(catTotal)}</span>
        </div>
        <div class="divide-y divide-gray-50">
          ${vendors.map(v => {
            const pct = totalUsed > 0 ? Math.round((v.total_used||0)/totalUsed*100) : 0
            const budgetPct = v.monthly_budget > 0 ? Math.round((v.total_used||0)/v.monthly_budget*100) : 0
            const overBudget = v.monthly_budget > 0 && v.total_used > v.monthly_budget
            return `<div class="py-2.5">
              <div class="flex items-center justify-between mb-1">
                <span class="text-sm font-medium text-gray-700">${v.name}</span>
                <div class="text-right">
                  <span class="font-bold text-sm ${overBudget?'text-red-600':'text-gray-800'}">${fmtW(v.total_used||0)}</span>
                  ${v.monthly_budget > 0 ? `<span class="text-xs text-gray-400 ml-1">/ ${fmtM(v.monthly_budget)}</span>` : ''}
                </div>
              </div>
              ${v.monthly_budget > 0 ? `
              <div class="progress-bar" style="height:4px">
                <div class="progress-fill" style="width:${Math.min(budgetPct,100)}%;background:${overBudget?'#ef4444':'#3b82f6'}"></div>
              </div>
              <div class="flex justify-between text-xs mt-0.5">
                <span class="text-gray-400">${pct}% (전체 발주 비중)</span>
                <span class="${overBudget?'text-red-500 font-semibold':'text-gray-400'}">${budgetPct}% (예산 대비)</span>
              </div>` : `<div class="text-xs text-gray-400">${pct}% (전체 발주 비중)</div>`}
            </div>`
          }).join('')}
        </div>
      </div>`
    }).join('')}

    ${sorted.length === 0 ? '<p class="text-gray-400 text-sm text-center py-8">이번 달 발주 내역이 없습니다</p>' : ''}
  </div>`
}

// ── 식수 현황 탭 (분류별 상세 + 전달 대비) ───────────────────────
function renderMealsTab(mealStats, mealFieldBreakdown, prevMonthData) {
  const totalMeals = mealStats.totalMeals || 0
  const daysEntered = mealStats.daysEntered || 0
  const avgPerDay = daysEntered > 0 ? Math.round(totalMeals / daysEntered) : 0
  const fbd = (mealFieldBreakdown||[])
  const fbdActive = fbd.filter(f => f.thisMonth > 0 || f.prevMonth > 0)
  const prevLabel = prevMonthData && prevMonthData.month ? `${prevMonthData.month}월` : '전달'

  const getFieldStyle = (key, name) => {
    if (key.startsWith('diet_preset_staff_') || name.includes('직원'))
      return {color:'#3b82f6', bg:'bg-blue-50', text:'text-blue-700', badge:'bg-blue-100 text-blue-700', label:'직원식'}
    if (key.startsWith('diet_preset_nc_') || name.includes('보호자') || name.includes('비급여'))
      return {color:'#9333ea', bg:'bg-purple-50', text:'text-purple-700', badge:'bg-purple-100 text-purple-700', label:'비급여식'}
    if (key.startsWith('diet_preset_therapy_') || name.includes('치료식') || name.includes('절제') || name.includes('잔사') || name.includes('요오드') || name.includes('기타 치료'))
      return {color:'#ea580c', bg:'bg-orange-50', text:'text-orange-700', badge:'bg-orange-100 text-orange-700', label:'치료식'}
    if (key.startsWith('cat_') || name.includes('항암') || name.includes('요양') || name.includes('일반'))
      return {color:'#16a34a', bg:'bg-green-50', text:'text-green-700', badge:'bg-green-100 text-green-700', label:'환자식'}
    return {color:'#6b7280', bg:'bg-gray-50', text:'text-gray-600', badge:'bg-gray-100 text-gray-600', label:'기타'}
  }

  return `
  <div class="space-y-4">
    <!-- 요약 3개 KPI -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-green-50 rounded-xl p-3 text-center">
        <div class="text-xs text-green-600 mb-1">총 식수</div>
        <div class="font-bold text-green-800 text-lg">${fmt(totalMeals)}식</div>
        ${prevMonthData && (prevMonthData.totalMeals||0) > 0 ? `<div class="text-xs text-gray-400 mt-0.5">전달 ${fmt(prevMonthData.totalMeals||0)}식</div>` : ''}
      </div>
      <div class="bg-blue-50 rounded-xl p-3 text-center">
        <div class="text-xs text-blue-600 mb-1">입력일수</div>
        <div class="font-bold text-blue-800 text-lg">${daysEntered}일</div>
      </div>
      <div class="bg-amber-50 rounded-xl p-3 text-center">
        <div class="text-xs text-amber-600 mb-1">일평균 식수</div>
        <div class="font-bold text-amber-800 text-lg">${fmt(avgPerDay)}식</div>
      </div>
    </div>

    <!-- 식단 유형별 분류 + 전달 대비 상세 테이블 -->
    <div>
      <h3 class="font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <i class="fas fa-list-ul text-teal-500 text-sm"></i>식단 유형별 분류 현황
        <span class="text-xs font-normal text-gray-400 ml-auto">전달(${prevLabel}) 대비</span>
      </h3>
      ${fbdActive.length > 0 ? `
      <div class="overflow-hidden rounded-xl border border-gray-100 shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-50 text-gray-600 border-b border-gray-100">
              <th class="text-left px-3 py-2.5 font-semibold text-xs">유형</th>
              <th class="text-right px-3 py-2.5 font-semibold text-xs">이번달</th>
              <th class="text-right px-3 py-2.5 font-semibold text-xs">비율</th>
              <th class="text-right px-3 py-2.5 font-semibold text-xs">${prevLabel}</th>
              <th class="text-right px-3 py-2.5 font-semibold text-xs">증감</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            ${fbdActive.map((f, i) => {
              const st = getFieldStyle(f.field_key, f.field_name)
              const unit = f.unit_type === 'ea' ? '개' : '식'
              const pct = totalMeals > 0 ? (f.thisMonth/totalMeals*100).toFixed(1) : '0.0'
              const prevPct = (fbd.reduce((s,x)=>s+x.prevMonth,0)) > 0 ? (f.prevMonth/fbd.reduce((s,x)=>s+x.prevMonth,0)*100).toFixed(1) : '0.0'
              const diffStr = f.diff > 0 ? `<span class="text-emerald-600 font-bold">+${fmt(f.diff)}</span>`
                            : f.diff < 0 ? `<span class="text-red-500 font-bold">${fmt(f.diff)}</span>`
                            : `<span class="text-gray-300">-</span>`
              return `<tr class="${i%2===0?'bg-white':'bg-gray-50/40'}">
                <td class="px-3 py-2.5">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${st.color}"></span>
                    <div>
                      <div class="font-medium text-gray-800">${f.field_name}</div>
                      <div class="text-xs text-gray-400">${st.label}</div>
                    </div>
                  </div>
                </td>
                <td class="text-right px-3 py-2.5">
                  <span class="font-bold text-base" style="color:${st.color}">${fmt(f.thisMonth)}</span>
                  <span class="text-xs text-gray-500 ml-0.5">${unit}</span>
                </td>
                <td class="text-right px-3 py-2.5">
                  <div class="flex items-center justify-end gap-1">
                    <div class="w-12 bg-gray-100 rounded-full overflow-hidden" style="height:4px">
                      <div style="width:${Math.min(parseFloat(pct),100)}%;height:100%;background:${st.color};border-radius:9999px"></div>
                    </div>
                    <span class="text-xs text-gray-500 w-8 text-right">${pct}%</span>
                  </div>
                </td>
                <td class="text-right px-3 py-2.5 text-gray-500 text-xs">${f.prevMonth > 0 ? fmt(f.prevMonth)+unit : '-'}</td>
                <td class="text-right px-3 py-2.5">${diffStr}</td>
              </tr>`
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="bg-teal-50 font-semibold text-teal-800 border-t border-teal-100">
              <td class="px-3 py-2.5 text-sm">합계</td>
              <td class="text-right px-3 py-2.5 text-sm">${fmt(fbdActive.reduce((s,f)=>s+f.thisMonth,0))}식</td>
              <td class="text-right px-3 py-2.5 text-xs text-teal-600">100%</td>
              <td class="text-right px-3 py-2.5 text-xs text-gray-500">${fmt(fbdActive.reduce((s,f)=>s+f.prevMonth,0))}식</td>
              <td class="text-right px-3 py-2.5 text-xs">${(()=>{const d=fbdActive.reduce((s,f)=>s+f.diff,0);return d>0?`<span class="text-emerald-600">+${fmt(d)}</span>`:d<0?`<span class="text-red-500">${fmt(d)}</span>`:`<span class="text-gray-300">-</span>`})()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- 시각화: 구성 비율 바 -->
      <div class="mt-4 p-3 bg-gray-50 rounded-xl">
        <div class="text-xs text-gray-500 mb-2 font-medium">식단 유형 구성 비율</div>
        <div class="flex rounded-full overflow-hidden h-4">
          ${fbdActive.filter(f=>f.unit_type!=='ea'&&f.thisMonth>0).map(f => {
            const st = getFieldStyle(f.field_key, f.field_name)
            const pct = totalMeals > 0 ? (f.thisMonth/totalMeals*100).toFixed(1) : 0
            return `<div title="${f.field_name}: ${pct}%" style="width:${pct}%;background:${st.color};min-width:2px" class="transition-all"></div>`
          }).join('')}
        </div>
        <div class="flex flex-wrap gap-2 mt-2">
          ${fbdActive.filter(f=>f.unit_type!=='ea'&&f.thisMonth>0).map(f => {
            const st = getFieldStyle(f.field_key, f.field_name)
            const pct = totalMeals > 0 ? (f.thisMonth/totalMeals*100).toFixed(1) : 0
            return `<div class="flex items-center gap-1 text-xs text-gray-600">
              <span class="w-2 h-2 rounded-full" style="background:${st.color}"></span>
              <span>${f.field_name} ${pct}%</span>
            </div>`
          }).join('')}
        </div>
      </div>` : `
      <div class="text-center py-8 text-gray-400">
        <i class="fas fa-utensils text-4xl mb-3 block text-gray-300"></i>
        <p>이번 달 식수 데이터가 없습니다</p>
      </div>`}
    </div>
  </div>`
}

// ── 법인카드 탭 ───────────────────────────────────────────────────
function renderCardTab(cardExpenses) {
  const total = cardExpenses.reduce((s,e) => s + (e.amount||0), 0)
  const byMonth = {}
  cardExpenses.forEach(e => {
    const d = (e.expense_date||'').split('T')[0]
    if (!byMonth[d]) byMonth[d] = []
    byMonth[d].push(e)
  })
  const sortedDates = Object.keys(byMonth).sort().reverse()

  return `
  <div class="space-y-4">
    <!-- 합계 -->
    <div class="bg-purple-50 rounded-xl p-4 flex items-center justify-between">
      <div>
        <div class="text-xs text-purple-600 mb-1">이번 달 법인카드 합계</div>
        <div class="font-bold text-purple-800 text-xl">${fmtW(total)}</div>
      </div>
      <div class="w-12 h-12 rounded-xl gradient-purple flex items-center justify-center">
        <i class="fas fa-credit-card text-white text-lg"></i>
      </div>
    </div>

    <!-- 내역 -->
    ${sortedDates.length === 0
      ? `<div class="text-center py-8 text-gray-400">
          <i class="fas fa-credit-card text-4xl mb-3 block text-gray-300"></i>
          <p>이번 달 법인카드 내역이 없습니다</p>
        </div>`
      : sortedDates.map(d => `
        <div>
          <div class="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
            <i class="fas fa-calendar text-gray-400"></i>${d}
          </div>
          <div class="space-y-2">
            ${byMonth[d].map(e => `
            <div class="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
              <div class="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                <i class="fas fa-credit-card text-purple-600 text-xs"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm text-gray-800">${e.vendor_name || '-'}</div>
                <div class="text-xs text-gray-400">${e.item_name || ''} ${e.purpose ? `· ${e.purpose}` : ''} ${e.expense_type ? `· ${e.expense_type}` : ''}</div>
              </div>
              <div class="font-bold text-sm text-gray-800 flex-shrink-0">${fmtW(e.amount||0)}</div>
            </div>`).join('')}
          </div>
        </div>`
      ).join('')}
  </div>`
}

// ── 지출결의서 탭 ─────────────────────────────────────────────────
function renderTransactionsTab(transactions) {
  const total = transactions.reduce((s,t) => s + (t.total_amount||0), 0)

  return `
  <div class="space-y-4">
    <!-- 합계 -->
    <div class="bg-amber-50 rounded-xl p-4 flex items-center justify-between">
      <div>
        <div class="text-xs text-amber-600 mb-1">이번 달 거래명세서 합계</div>
        <div class="font-bold text-amber-800 text-xl">${fmtW(total)}</div>
        <div class="text-xs text-amber-500 mt-0.5">총 ${transactions.length}건</div>
      </div>
      <div class="w-12 h-12 rounded-xl gradient-amber flex items-center justify-center">
        <i class="fas fa-file-invoice text-white text-lg"></i>
      </div>
    </div>

    <!-- 목록 -->
    ${transactions.length === 0
      ? `<div class="text-center py-8 text-gray-400">
          <i class="fas fa-file-invoice text-4xl mb-3 block text-gray-300"></i>
          <p>이번 달 거래명세서가 없습니다</p>
        </div>`
      : `<div class="space-y-2">
          ${transactions.map(t => `
            <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition">
              <div class="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <i class="fas fa-file-alt text-amber-600 text-sm"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm text-gray-800 truncate">${t.vendor_name || '-'}</div>
                <div class="text-xs text-gray-400">${t.document_number || ''} · ${(t.document_date||'').split('T')[0]}</div>
                ${t.memo ? `<div class="text-xs text-gray-400 truncate">${t.memo}</div>` : ''}
              </div>
              <div class="text-right flex-shrink-0">
                <div class="font-bold text-sm text-gray-800">${fmtW(t.total_amount||0)}</div>
              </div>
            </div>`).join('')}
        </div>`}
  </div>`
}

// ── 납품 현황 탭 (발주 일자별) ───────────────────────────────────
function renderScheduleTab(schedules) {
  const today = new Date().toISOString().split('T')[0]
  // 날짜별 그룹
  const byDate = {}
  ;(schedules||[]).forEach(s => {
    const d = (s.delivery_date||'').split('T')[0]
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(s)
  })
  const sortedDates = Object.keys(byDate).sort()

  if (sortedDates.length === 0) {
    return `<div class="text-center py-8 text-gray-400">
      <i class="fas fa-truck text-4xl mb-3 block text-gray-300"></i>
      <p>이번 달 발주 내역이 없습니다</p>
    </div>`
  }

  return `
  <div class="space-y-4">
    <div class="text-xs text-gray-400 mb-2">이번 달 발주 일자별 현황 (${sortedDates.length}일)</div>
    ${sortedDates.map(d => {
      const rows = byDate[d]
      const dayTotal = rows.reduce((s,r) => s + (r.total_amount||0), 0)
      const isToday = d === today
      const isPast = d < today
      const dayOfWeek = ['일','월','화','수','목','금','토'][new Date(d).getDay()]
      return `
      <div class="${isToday ? 'ring-2 ring-blue-400' : ''} rounded-xl overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 ${isPast ? 'bg-gray-100' : 'bg-blue-50'}">
          <div class="flex items-center gap-2">
            <span class="font-bold ${isPast ? 'text-gray-600' : 'text-blue-800'}">${d.slice(5)} (${dayOfWeek})</span>
            ${isToday ? `<span class="badge" style="background:#dbeafe;color:#1d4ed8">오늘</span>` : ''}
          </div>
          <span class="font-bold text-sm ${isPast ? 'text-gray-600' : 'text-blue-700'}">${fmtW(dayTotal)}</span>
        </div>
        <div class="divide-y divide-gray-50 bg-white">
          ${rows.map(r => `
          <div class="flex items-center gap-3 px-3 py-2">
            <i class="fas fa-truck text-gray-400 text-xs w-4"></i>
            <span class="flex-1 text-sm text-gray-700">${r.vendor_name || '-'}</span>
            <span class="text-sm font-medium text-gray-600">${fmtW(r.total_amount||0)}</span>
          </div>`).join('')}
        </div>
      </div>`
    }).join('')}
  </div>`
}

// ── 연간 추이 섹션 ────────────────────────────────────────────────
function renderAnnualSection() {
  return `
  <div class="exec-card p-4 md:p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-gray-800 flex items-center gap-2">
        <i class="fas fa-chart-line text-blue-600"></i>
        ${State.year}년 월별 추이
      </h2>
    </div>
    <div style="height:220px;position:relative">
      <canvas id="annualTrendChart"></canvas>
    </div>
  </div>`
}

// ── 차트: 예산 게이지 ────────────────────────────────────────────
function initBudgetGaugeChart(pct) {
  // 현재 진행바 UI로 대체 - 별도 canvas 없음
}

// ── 차트: 연간 추이 ──────────────────────────────────────────────
function initAnnualChart() {
  const canvas = document.getElementById('annualTrendChart')
  if (!canvas) return
  const annual = State.annualData
  if (!annual) return

  const labels = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const usedArr = new Array(12).fill(0)
  const budgetArr = new Array(12).fill(0)
  const cardArr = new Array(12).fill(0)

  ;(annual.monthly||[]).forEach(r => {
    const idx = parseInt(r.month||'0') - 1
    if (idx >= 0 && idx < 12) usedArr[idx] = r.total_used || 0
  })
  ;(annual.budgets||[]).forEach(r => {
    const idx = parseInt(r.month||'0') - 1
    if (idx >= 0 && idx < 12) budgetArr[idx] = r.total_budget || 0
  })
  ;(annual.cardMonthly||[]).forEach(r => {
    const idx = parseInt(r.month||'0') - 1
    if (idx >= 0 && idx < 12) cardArr[idx] = r.total || 0
  })

  if (State.charts.annual) { State.charts.annual.destroy() }

  State.charts.annual = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '발주금액',
          data: usedArr,
          backgroundColor: '#3b82f680',
          borderColor: '#3b82f6',
          borderWidth: 1.5,
          borderRadius: 4
        },
        {
          label: '예산',
          data: budgetArr,
          type: 'line',
          borderColor: '#16a34a',
          borderWidth: 2,
          borderDash: [4,2],
          pointRadius: 3,
          fill: false,
          tension: 0.3
        },
        {
          label: '법인카드',
          data: cardArr,
          backgroundColor: '#9333ea40',
          borderColor: '#9333ea',
          borderWidth: 1.5,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtW(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          ticks: { callback: v => fmtM(v), font: { size: 10 } },
          grid: { color: '#f3f4f6' }
        },
        x: {
          ticks: { font: { size: 10 } },
          grid: { display: false }
        }
      }
    }
  })
}

// ── 차트: 업체 파이 ───────────────────────────────────────────────
function initVendorChart(vendorOrders) {
  const canvas = document.getElementById('vendorPieChart')
  if (!canvas) return
  const top6 = [...vendorOrders].sort((a,b) => (b.total_used||0)-(a.total_used||0)).slice(0,6)
  if (top6.length === 0) {
    canvas.parentElement.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">발주 데이터 없음</p>'
    return
  }

  const colors = ['#3b82f6','#16a34a','#d97706','#9333ea','#ef4444','#06b6d4']
  if (State.charts.vendor) { State.charts.vendor.destroy() }

  State.charts.vendor = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: top6.map(v => v.name),
      datasets: [{
        data: top6.map(v => v.total_used||0),
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${fmtW(ctx.parsed)}`
          }
        }
      }
    }
  })
}

// ── 인력 & 인건비 현황 섹션 ──────────────────────────────────────
function renderExecStaffLaborSection(d) {
  if (!d) return ''

  const fmtN = v => (v || 0).toLocaleString()
  const fmtW2 = v => {
    v = v || 0
    if (v >= 100000000) return `${(v/100000000).toFixed(1)}억`
    if (v >= 10000)     return `${Math.round(v/10000)}만`
    return v.toLocaleString()
  }

  const ss = d.staffSummary  || {}
  const ws = d.workSummary   || {}
  const es = d.externalSummary || {}
  const lc = d.laborCost     || {}
  const warnings = d.warnings || []

  const totalLC       = lc.total || 1
  // show_base_salary OFF 시 기본급을 제외한 합계를 표시용으로 계산
  const showBase = d.showBaseSalary === true
  const displayTotal  = showBase ? (lc.total || 0) : ((lc.otCost || 0) + (lc.dispatchCost || 0) + (lc.parttimeCost || 0))
  const displayBase   = showBase ? totalLC : Math.max(displayTotal, 1)   // 비율 계산 분모

  const baseRatio     = Math.round(((lc.baseSalary  || 0) / displayBase) * 100)
  const otRatio       = Math.round(((lc.otCost      || 0) / displayBase) * 100)
  const dispatchRatio = Math.round(((lc.dispatchCost|| 0) / displayBase) * 100)
  const parttimeRatio = Math.round(((lc.parttimeCost|| 0) / displayBase) * 100)
  const extRatio      = dispatchRatio + parttimeRatio

  const dispatchDiff = (es.dispatchDays || 0) - (es.prevDispatchDays || 0)
  const parttimeDiff = (es.parttimeDays || 0) - (es.prevParttimeDays || 0)
  const diffBadge = diff => diff === 0
    ? `<span style="color:#9ca3af;font-size:11px;margin-left:3px">±0</span>`
    : diff > 0
      ? `<span style="color:#ef4444;font-size:11px;margin-left:3px">▲${diff}</span>`
      : `<span style="color:#22c55e;font-size:11px;margin-left:3px">▼${Math.abs(diff)}</span>`

  const warnHtml = warnings.length > 0
    ? warnings.map(w => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-radius:8px;
        background:${w.level==='danger'?'#fef2f2':'#fffbeb'};
        border:1px solid ${w.level==='danger'?'#fecaca':'#fde68a'};">
        <i class="fas fa-exclamation-triangle" style="font-size:11px;margin-top:2px;color:${w.level==='danger'?'#ef4444':'#f59e0b'}"></i>
        <span style="font-size:12px;color:${w.level==='danger'?'#b91c1c':'#92400e'}">${w.message}</span>
      </div>`).join('')
    : `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;">
        <i class="fas fa-check-circle" style="font-size:11px;color:#16a34a"></i>
        <span style="font-size:12px;color:#15803d">인력 운영이 정상 범위입니다</span>
      </div>`

  const costItems = [
    ...(showBase ? [{ label:'기본급', val: lc.baseSalary || 0, ratio: baseRatio, color:'#818cf8' }] : []),
    { label:'초과근무(OT)', val: lc.otCost        || 0, ratio: otRatio,       color:'#fbbf24' },
    { label:'파출비',       val: lc.dispatchCost  || 0, ratio: dispatchRatio, color:'#fb923c' },
    { label:'알바비',       val: lc.parttimeCost  || 0, ratio: parttimeRatio, color:'#facc15' },
  ]

  return `
  <div class="exec-card overflow-hidden" style="margin-top:16px">
    <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between">
      <div>
        <h3 style="font-weight:700;font-size:14px;color:#1f2937;display:flex;align-items:center;gap:8px">
          <i class="fas fa-users" style="color:#6366f1"></i>인력 & 인건비 현황
        </h3>
        <p style="font-size:11px;color:#9ca3af;margin-top:2px">이번 달 인력 운영 및 비용 내역</p>
      </div>
      ${warnings.length > 0
        ? `<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:#fef3c7;color:#b45309">⚠️ 주의 ${warnings.length}건</span>`
        : `<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:#dcfce7;color:#16a34a">✓ 정상</span>`}
    </div>

    <div style="padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px">

      <!-- 왼쪽: 인력 현황 -->
      <div style="display:flex;flex-direction:column;gap:12px">

        <!-- 직원 구성 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="background:#eef2ff;border-radius:12px;padding:12px">
            <p style="font-size:11px;font-weight:600;color:#6366f1;margin-bottom:4px">전체 재직</p>
            <p style="font-size:22px;font-weight:800;color:#4338ca">${fmtN(ss.total)}<span style="font-size:12px;font-weight:400;margin-left:2px">명</span></p>
            <p style="font-size:11px;color:#a5b4fc;margin-top:2px">출근 ${fmtN(ss.activeThisMonth)}명</p>
          </div>
          <div style="background:#eff6ff;border-radius:12px;padding:12px">
            <p style="font-size:11px;font-weight:600;color:#3b82f6;margin-bottom:4px">고용 형태</p>
            ${[['정규직', ss.fullTime], ['계약직', ss.contract], ['시간제', ss.partTime]].map(([l,v]) => `
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:2px">
                <span style="color:#6b7280">${l}</span>
                <span style="font-weight:700;color:#1d4ed8">${fmtN(v)}명</span>
              </div>`).join('')}
          </div>
        </div>

        <!-- OT 현황 -->
        <div style="background:#fffbeb;border-radius:12px;padding:12px">
          <p style="font-size:11px;font-weight:600;color:#d97706;margin-bottom:8px">📋 초과근무(OT) 현황</p>
          <div style="display:flex;gap:16px">
            ${[['OT 발생', ws.totalOtDays, '건'], ['OT 시간', ws.totalOtHours, 'h'], ['휴가/연차', ws.totalLeaveDays, '일']].map(([l,v,u]) => `
              <div style="text-align:center">
                <p style="font-size:18px;font-weight:700;color:#b45309">${fmtN(v)}<span style="font-size:11px;font-weight:400">${u}</span></p>
                <p style="font-size:11px;color:#9ca3af">${l}</p>
              </div>`).join('')}
          </div>
        </div>

        <!-- 외부인력 -->
        <div style="background:#fff7ed;border-radius:12px;padding:12px">
          <p style="font-size:11px;font-weight:600;color:#ea580c;margin-bottom:8px">🔄 외부인력 투입 현황</p>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;color:#374151">파출 <span style="color:#9ca3af">(${fmtN(es.dispatchWorkerCount)}명)</span></span>
              <div style="display:flex;align-items:center">
                <span style="font-size:14px;font-weight:700;color:#c2410c">${fmtN(es.dispatchDays)}회</span>
                ${diffBadge(dispatchDiff)}
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;color:#374151">알바 <span style="color:#9ca3af">(${fmtN(es.parttimeWorkerCount)}명)</span></span>
              <div style="display:flex;align-items:center">
                <span style="font-size:14px;font-weight:700;color:#b45309">${fmtN(es.parttimeDays)}회</span>
                ${diffBadge(parttimeDiff)}
              </div>
            </div>
          </div>
        </div>

        <!-- 경고 -->
        <div style="display:flex;flex-direction:column;gap:6px">${warnHtml}</div>
      </div>

      <!-- 오른쪽: 인건비 -->
      <div style="display:flex;flex-direction:column;gap:12px">

        <!-- 총 인건비 배너 -->
        <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:16px;color:white">
          <p style="font-size:11px;color:#c7d2fe;margin-bottom:4px">이번 달 총 인건비</p>
          <p style="font-size:28px;font-weight:800">${fmtW2(displayTotal)}<span style="font-size:14px;font-weight:400;margin-left:4px">원</span></p>
          <p style="font-size:11px;color:#c7d2fe;margin-top:4px">${showBase ? '기본급 + OT + 파출 + 알바 합산' : 'OT + 파출 + 알바 합산 (기본급 비공개)'}</p>
        </div>

        <!-- 항목별 막대 -->
        <div style="display:flex;flex-direction:column;gap:6px">
          ${costItems.map(item => `
            <div style="display:flex;align-items:center;justify-content:space-between;background:#f9fafb;border-radius:8px;padding:8px 12px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:10px;height:10px;border-radius:50%;background:${item.color};flex-shrink:0"></span>
                <span style="font-size:12px;color:#374151">${item.label}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:80px;background:#e5e7eb;border-radius:99px;height:6px">
                  <div style="width:${item.ratio}%;height:6px;border-radius:99px;background:${item.color}"></div>
                </div>
                <span style="font-size:12px;font-weight:700;color:#1f2937;width:60px;text-align:right">${fmtW2(item.val)}원</span>
              </div>
            </div>`).join('')}
        </div>

        <!-- 외부인력 비중 -->
        <div style="background:#f9fafb;border-radius:12px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <p style="font-size:12px;color:#6b7280">외부인력 비용 비중</p>
            <p style="font-size:14px;font-weight:700;color:${extRatio > 30 ? '#dc2626' : '#16a34a'}">${extRatio}%</p>
          </div>
          <div style="background:#e5e7eb;border-radius:99px;height:8px">
            <div style="width:${Math.min(100, extRatio)}%;height:8px;border-radius:99px;background:${extRatio > 30 ? '#f87171' : '#4ade80'}"></div>
          </div>
          <p style="font-size:11px;color:#9ca3af;margin-top:4px">권장 기준: 30% 이하 / 파출 ${fmtW2(lc.dispatchCost)}원 + 알바 ${fmtW2(lc.parttimeCost)}원</p>
        </div>

        <!-- 인건비 구성 도넛 차트 -->
        <div style="background:#f9fafb;border-radius:12px;padding:12px">
          <p style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">📊 인건비 구성 비율</p>
          <div style="display:flex;align-items:center;gap:12px">
            <canvas id="execLaborDonutChart" width="90" height="90" style="flex-shrink:0"></canvas>
            <div style="flex:1;display:flex;flex-direction:column;gap:4px">
              ${costItems.map(item => `
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div style="display:flex;align-items:center;gap:5px">
                    <span style="width:8px;height:8px;border-radius:50%;background:${item.color};flex-shrink:0"></span>
                    <span style="font-size:11px;color:#6b7280">${item.label}</span>
                  </div>
                  <span style="font-size:11px;font-weight:700;color:#374151">${item.ratio}%</span>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 직원별 추가수당 명세 -->
  ${(() => {
    const byEmp = d.byEmployee || []
    const showBase = d.showBaseSalary === true
    if (byEmp.length === 0) return ''
    const hasAddCost = byEmp.some(r => r.totalAddCost > 0)
    return `
  <div class="exec-card overflow-hidden" style="margin-top:16px">
    <div style="padding:14px 20px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between">
      <div>
        <h3 style="font-weight:700;font-size:14px;color:#1f2937;display:flex;align-items:center;gap:8px">
          <i class="fas fa-file-invoice-dollar" style="color:#f59e0b"></i>직원별 추가수당 명세
        </h3>
        <p style="font-size:11px;color:#9ca3af;margin-top:2px">OT·야간·휴일·주휴수당 — 기본급 외 추가 발생 비용</p>
      </div>
      ${!showBase ? '<span style="font-size:11px;padding:3px 10px;border-radius:99px;background:#f3f4f6;color:#9ca3af"><i class="fas fa-eye-slash" style="margin-right:4px"></i>기본급 비공개</span>' : ''}
    </div>
    <div style="overflow-x:auto;padding:0">
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead>
          <tr style="background:#fafafa;border-bottom:1px solid #e5e7eb">
            <th style="padding:8px 14px;text-align:left;color:#6b7280;font-weight:600">직원</th>
            <th style="padding:8px 10px;text-align:center;color:#6b7280;font-weight:600">근무일</th>
            ${showBase ? '<th style="padding:8px 10px;text-align:right;color:#6b7280;font-weight:600">기본급</th>' : ''}
            <th style="padding:8px 10px;text-align:center;color:#3b82f6;font-weight:600">OT시간</th>
            <th style="padding:8px 10px;text-align:right;color:#3b82f6;font-weight:600">OT수당</th>
            <th style="padding:8px 10px;text-align:center;color:#8b5cf6;font-weight:600">야간(h)</th>
            <th style="padding:8px 10px;text-align:right;color:#8b5cf6;font-weight:600">야간수당</th>
            <th style="padding:8px 10px;text-align:center;color:#ef4444;font-weight:600">휴일(h)</th>
            <th style="padding:8px 10px;text-align:right;color:#ef4444;font-weight:600">휴일수당</th>
            <th style="padding:8px 10px;text-align:right;color:#0d9488;font-weight:600">주휴수당</th>
            <th style="padding:8px 10px;text-align:right;color:#1f2937;font-weight:700">추가합계</th>
          </tr>
        </thead>
        <tbody>
          ${byEmp.map((r, i) => {
            const addTotal = r.totalAddCost || 0
            const hasAdd = addTotal > 0
            return `
          <tr style="border-bottom:1px solid #f3f4f6;background:${i%2===0?'#fff':'#fafafa'}">
            <td style="padding:8px 14px">
              <span style="font-weight:600;color:#1f2937">${r.empName || ''}</span>
            </td>
            <td style="padding:8px 10px;text-align:center;color:#6b7280">${r.workDays || 0}일</td>
            ${showBase ? `<td style="padding:8px 10px;text-align:right;color:#374151">${fmtW2(r.estimatedMonthly)}원</td>` : ''}
            <td style="padding:8px 10px;text-align:center;color:${(r.otHours||0)>0?'#2563eb':'#9ca3af'};font-weight:${(r.otHours||0)>0?'700':'400'}">${(r.otHours||0).toFixed(1)}h</td>
            <td style="padding:8px 10px;text-align:right;color:${(r.otCost||0)>0?'#1d4ed8':'#9ca3af'}">${(r.otCost||0)>0?fmtW2(r.otCost)+'원':'-'}</td>
            <td style="padding:8px 10px;text-align:center;color:${(r.nightHours||0)>0?'#7c3aed':'#9ca3af'}">${(r.nightHours||0).toFixed(1)}h</td>
            <td style="padding:8px 10px;text-align:right;color:${(r.nightCost||0)>0?'#6d28d9':'#9ca3af'}">${(r.nightCost||0)>0?fmtW2(r.nightCost)+'원':'-'}</td>
            <td style="padding:8px 10px;text-align:center;color:${(r.holidayHours||0)>0?'#dc2626':'#9ca3af'}">${(r.holidayHours||0).toFixed(1)}h</td>
            <td style="padding:8px 10px;text-align:right;color:${(r.holidayCost||0)>0?'#b91c1c':'#9ca3af'}">${(r.holidayCost||0)>0?fmtW2(r.holidayCost)+'원':'-'}</td>
            <td style="padding:8px 10px;text-align:right;color:${(r.weeklyHolidayCost||0)>0?'#0f766e':'#9ca3af'}">${(r.weeklyHolidayCost||0)>0?fmtW2(r.weeklyHolidayCost)+'원':'-'}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:${hasAdd?'#d97706':'#9ca3af'}">${hasAdd?fmtW2(addTotal)+'원':'-'}</td>
          </tr>`
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#fffbeb;border-top:2px solid #fde68a">
            <td style="padding:8px 14px;font-weight:700;color:#92400e" colspan="${showBase?2:2}">합계</td>
            ${showBase ? `<td style="padding:8px 10px;text-align:right;font-weight:700;color:#374151">${fmtW2(byEmp.reduce((s,r)=>s+(r.estimatedMonthly||0),0))}원</td>` : ''}
            <td style="padding:8px 10px;text-align:center;font-weight:700;color:#2563eb">${byEmp.reduce((s,r)=>s+(r.otHours||0),0).toFixed(1)}h</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:#1d4ed8">${fmtW2(byEmp.reduce((s,r)=>s+(r.otCost||0),0))}원</td>
            <td style="padding:8px 10px;text-align:center;font-weight:700;color:#7c3aed">${byEmp.reduce((s,r)=>s+(r.nightHours||0),0).toFixed(1)}h</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:#6d28d9">${fmtW2(byEmp.reduce((s,r)=>s+(r.nightCost||0),0))}원</td>
            <td style="padding:8px 10px;text-align:center;font-weight:700;color:#dc2626">${byEmp.reduce((s,r)=>s+(r.holidayHours||0),0).toFixed(1)}h</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:#b91c1c">${fmtW2(byEmp.reduce((s,r)=>s+(r.holidayCost||0),0))}원</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:#0f766e">${fmtW2(byEmp.reduce((s,r)=>s+(r.weeklyHolidayCost||0),0))}원</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:#d97706">${fmtW2(byEmp.reduce((s,r)=>s+(r.totalAddCost||0),0))}원</td>
          </tr>
        </tfoot>
      </table>
    </div>
    ${hasAddCost ? `
    <div style="padding:10px 16px;background:#fffbeb;border-top:1px solid #fde68a;font-size:11px;color:#92400e">
      <i class="fas fa-lightbulb" style="margin-right:4px"></i>
      추가수당 합계 <strong>${fmtW2(byEmp.reduce((s,r)=>s+(r.totalAddCost||0),0))}원</strong>은 
      기본 급여 외 발생하는 비용입니다. 리엔에이치 스케줄 최적화를 통해 절감할 수 있습니다.
    </div>` : ''}
  </div>`
  })()}
  `
}

// ── 운영진 전용 인력 근무현황 탭 ─────────────────────────────────
function renderExecStaffScheduleTab() {
  try {
    const md = State.scheduleMonth
    const sl = State.staffLabor
    const showBase = sl?.showBaseSalary === true   // 급여 공개 설정
    const year = State.year
    const month = State.month
    if (!md) return `<div style="text-align:center;padding:40px;color:#9ca3af"><i class="fas fa-spinner fa-spin" style="font-size:24px;margin-bottom:12px;display:block"></i>근무 데이터 로딩 중...</div>`

    const emps = md.employees || []
    const sm = md.sched_map || {}
    const shifts = md.shifts || []
    const holidays = md.holidays || []
    const extWorkers = md.external_workers || []
    const extMap = md.ext_sched_map || {}
    const holidaySet = new Set(holidays.map(h=>h.date||h))
    const REST_CODES = new Set(['연','휴','경조','병가'])
    const days = new Date(year, month, 0).getDate()
    const dayNames = ['일','월','화','수','목','금','토']

    const shiftColorMap = {}
    shifts.forEach(s => { shiftColorMap[s.shift_code] = s.color })

    function getCodeBg(code) {
      if (!code || code==='-') return {bg:'#f3f4f6',fg:'#9ca3af'}
      if (shiftColorMap[code]) { const h=shiftColorMap[code]; return {bg:h+'28',fg:h} }
      const dm = {'연':'#fef3c7,#92400e','휴':'#fee2e2,#b91c1c','경조':'#fdf4ff,#9333ea','OT':'#dcfce7,#16a34a'}
      const p=(dm[code]||'#f3f4f6,#374151').split(',')
      return {bg:p[0],fg:p[1]}
    }

    // ── 직원별 통계 계산 ──
    const empStats = emps.map(emp => {
      let workDays=0, offDays=0, totalHrs=0
      const codeCounts={}
      let curConsec=0, maxConsec=0
      for (let d=1;d<=days;d++) {
        const ds=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        const entry=(sm[`${emp.id}_${ds}`])||{}
        const code=entry.shift_code||''
        if(!code||code==='-'){curConsec=0;continue}
        codeCounts[code]=(codeCounts[code]||0)+1
        if(REST_CODES.has(code)){offDays++;curConsec=0;continue}
        workDays++; curConsec++
        if(curConsec>maxConsec)maxConsec=curConsec
        // 근무시간
        const sf=shifts.find(s=>s.shift_code===code)
        if(sf?.start_time&&sf?.end_time){
          const[sh,sm2]=sf.start_time.split(':').map(Number)
          const[eh,em]=sf.end_time.split(':').map(Number)
          let h=(eh*60+em-sh*60-sm2)/60; if(h<0)h+=24
          totalHrs+=Math.max(0,h-1)
        } else totalHrs+=8
      }
      // 예상급여 계산
      let estimatedSalary=null
      const sal=parseFloat(emp.base_salary||0)
      if(sal>0){
        if(emp.salary_type==='hourly') estimatedSalary=Math.round(totalHrs*sal)
        else if(emp.salary_type==='annual') estimatedSalary=Math.round(sal/12)
        else estimatedSalary=sal // monthly
      }
      return {...emp,workDays,offDays,totalHrs,codeCounts,maxConsec,estimatedSalary}
    })

    const avgWork = empStats.length ? (empStats.reduce((a,e)=>a+e.workDays,0)/empStats.length) : 0
    const totalSalary = empStats.reduce((a,e)=>a+(e.estimatedSalary||0),0)

    // 외부인력 집계
    let extWorkDays=0, dispatchDays=0, parttimeDays=0
    extWorkers.forEach(w=>{
      for(let d=1;d<=days;d++){
        const ds=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        if(extMap[`${w.id}_${ds}`]?.shift_type||extMap[`${w.id}_${ds}`]?.shift_code){
          extWorkDays++
          if(w.worker_type==='dispatch')dispatchDays++
          else parttimeDays++
        }
      }
    })

    // 날짜 헤더 - 일자 행 + 요일 행 분리
    const dateRow = Array.from({length:days},(_,i)=>{
      const day=i+1
      const dow=new Date(year,month-1,day).getDay()
      const ds=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      const isHol=holidaySet.has(ds)
      const isSun=dow===0, isSat=dow===6
      const bg=isHol?'#b91c1c':isSun?'#dc2626':isSat?'#1d4ed8':'#166534'
      return `<th style="padding:3px 0;min-width:24px;text-align:center;font-size:10px;font-weight:800;background:${bg};color:white;border-left:1px solid rgba(255,255,255,.2)">${day}</th>`
    }).join('')
    const dowRow = Array.from({length:days},(_,i)=>{
      const day=i+1
      const dow=new Date(year,month-1,day).getDay()
      const ds=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      const isHol=holidaySet.has(ds)
      const isSun=dow===0, isSat=dow===6
      const bg=isHol?'#ef4444':isSun?'#ef4444':isSat?'#3b82f6':'#1e8a4a'
      return `<th style="padding:2px 0;min-width:24px;text-align:center;font-size:9px;background:${bg};color:white;border-left:1px solid rgba(255,255,255,.2);opacity:.85">${dayNames[dow]}${isHol?'★':''}</th>`
    }).join('')

    // 직위별 그룹 분류
    const POSITION_GROUPS = [
      {key:'nutritionist', label:'영양사', icon:'fa-heartbeat', color:'#be185d', bg:'#fdf2f8', border:'#f9a8d4',
       filter: e => e.team==='nutrition'},
      {key:'chef', label:'조리장/셰프', icon:'fa-hat-chef', color:'#92400e', bg:'#fffbeb', border:'#fde68a',
       filter: e => e.team!=='nutrition' && /(장|셰프|chef|수석)/i.test(e.position_name||e.position||'')},
      {key:'cook', label:'조리사', icon:'fa-utensils', color:'#166534', bg:'#f0fdf4', border:'#bbf7d0',
       filter: e => e.team!=='nutrition' && /(조리사)/i.test(e.position_name||e.position||'')},
      {key:'assistant', label:'조리원', icon:'fa-user-chef', color:'#1d4ed8', bg:'#eff6ff', border:'#bfdbfe',
       filter: e => e.team!=='nutrition' && /(조리원)/i.test(e.position_name||e.position||'')},
      {key:'manager', label:'매니저', icon:'fa-user-tie', color:'#6d28d9', bg:'#f5f3ff', border:'#ddd6fe',
       filter: e => e.team!=='nutrition' && /(매니저|manager)/i.test(e.position_name||e.position||'')},
      {key:'parttime', label:'파트타이머', icon:'fa-user-clock', color:'#0891b2', bg:'#ecfeff', border:'#a5f3fc',
       filter: e => e.team!=='nutrition' && /(파트|파트타이|part)/i.test(e.position_name||e.position||'')},
      {key:'other', label:'기타', icon:'fa-user', color:'#374151', bg:'#f9fafb', border:'#e5e7eb',
       filter: null} // 나머지
    ]

    // 그룹 배정
    const assigned = new Set()
    const grouped = []
    POSITION_GROUPS.forEach((grp,gi) => {
      let members
      if (grp.filter) {
        members = empStats.filter(e => !assigned.has(e.id) && grp.filter(e))
      } else {
        members = empStats.filter(e => !assigned.has(e.id))
      }
      members.forEach(e=>assigned.add(e.id))
      if (members.length > 0) grouped.push({...grp, members})
    })

    // 직원 테이블 HTML 생성
    function buildGroupRows(grp) {
      const headerBg = grp.bg
      let html = ''
      // 그룹 구분 헤더 행 (분리 칸)
      html += `<tr>
        <td colspan="${days+4}" style="padding:0">
          <div style="background:${grp.bg};border-top:3px solid ${grp.color};border-bottom:1px solid ${grp.border};padding:5px 12px;display:flex;align-items:center;gap:7px">
            <i class="fas ${grp.icon}" style="color:${grp.color};font-size:12px"></i>
            <span style="font-size:12px;font-weight:800;color:${grp.color}">${grp.label}</span>
            <span style="font-size:10px;color:${grp.color};opacity:.7">(${grp.members.length}명)</span>
          </div>
        </td>
      </tr>`
      // 날짜 헤더 (일자 + 요일 2행, 그룹마다 반복)
      html += `<tr style="background:${grp.color}dd">
        <th style="padding:4px 8px;text-align:left;min-width:80px;position:sticky;left:0;background:${grp.color};z-index:5;color:white;font-size:11px;border-right:2px solid rgba(255,255,255,.3)">이름</th>
        ${dateRow}
        <th style="padding:3px 4px;min-width:32px;text-align:center;font-size:9px;color:white;border-left:2px solid rgba(255,255,255,.3)">근무</th>
        <th style="padding:3px 4px;min-width:32px;text-align:center;font-size:9px;color:white">휴무</th>
        ${showBase ? '<th style="padding:3px 4px;min-width:70px;text-align:right;font-size:9px;color:white;border-left:1px solid rgba(255,255,255,.3)">예상급여</th>' : ''}
      </tr>
      <tr style="background:${grp.color}cc">
        <th style="padding:2px 8px;position:sticky;left:0;background:${grp.color}dd;z-index:5;color:rgba(255,255,255,.8);font-size:9px;border-right:2px solid rgba(255,255,255,.3)">직위</th>
        ${dowRow}
        <th colspan="3" style="border-left:2px solid rgba(255,255,255,.3)"></th>
      </tr>`

      // 직원 행
      grp.members.forEach((emp, idx) => {
        const rowBg = idx%2===0 ? '#fff' : grp.bg
        const cells = Array.from({length:days},(_,i)=>{
          const day=i+1
          const ds=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const dow=new Date(year,month-1,day).getDay()
          const isHol=holidaySet.has(ds), isSun=dow===0, isSat=dow===6
          const entry=(sm[`${emp.id}_${ds}`])||{}
          const code=entry.shift_code||''
          const isOff=REST_CODES.has(code)
          const cellBg=isOff?(code==='연'?'#fef3c7':code==='경조'?'#fdf4ff':'#fee2e2'):isHol?'#fff1f2':isSun?'#fff5f5':isSat?'#eff6ff':rowBg
          const bc=isHol?'#fca5a5':isSun?'#fecaca':isSat?'#bfdbfe':'#e5e7eb'
          const {bg,fg}=getCodeBg(code)
          const badge=code?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:4px;background:${bg};color:${fg};font-size:10px;font-weight:800;${isHol&&!isOff?'border:1.5px solid #ef4444':''}">${code}</span>`:''
          return `<td style="padding:1px;text-align:center;background:${cellBg};border-left:1px solid ${bc};vertical-align:middle">${badge}</td>`
        }).join('')

        const salStr = showBase && emp.estimatedSalary!=null ? `<span style="font-size:10px;font-weight:700;color:${grp.color}">${emp.estimatedSalary.toLocaleString()}원</span>` : '<span style="font-size:10px;color:#d1d5db">-</span>'
        const salTypeLabel = showBase ? ({monthly:'월급',hourly:'시급',annual:'연봉'}[emp.salary_type||'monthly']||'') : ''

        html += `<tr style="border-bottom:1px solid ${grp.border}">
          <td style="padding:4px 8px;min-width:80px;position:sticky;left:0;background:${rowBg};z-index:5;border-right:2px solid ${grp.border}">
            <div style="font-size:11px;font-weight:700;color:#1f2937;white-space:nowrap">${emp.name}</div>
            <div style="font-size:9px;color:${grp.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:72px">${emp.position_name||emp.position||''}</div>
          </td>
          ${cells}
          <td style="padding:2px 3px;text-align:center;background:#f0fdf4;border-left:2px solid #d1fae5">
            <div style="font-size:12px;font-weight:900;color:#166534">${emp.workDays}</div>
          </td>
          <td style="padding:2px 3px;text-align:center;background:#fffbeb;border-left:1px solid #fde68a">
            <div style="font-size:12px;font-weight:900;color:#b45309">${emp.offDays}</div>
          </td>
          ${showBase ? `<td style="padding:3px 8px;text-align:right;background:#fafafa;border-left:1px solid #e5e7eb">
            ${salStr}
            <div style="font-size:8px;color:#9ca3af">${salTypeLabel}</div>
          </td>` : ''}
        </tr>`
      })
      return html
    }

    const tableRows = grouped.map(g=>buildGroupRows(g)).join('')

    // 외부인력 섹션
    let extSection = ''
    if (extWorkers.length > 0) {
      const extRows = extWorkers.map((w,i)=>{
        const rowBg=i%2===0?'#fff':'#fff7ed'
        const cells=Array.from({length:days},(_,d2)=>{
          const day=d2+1
          const ds=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const entry=extMap[`${w.id}_${ds}`]||{}
          const st=entry.shift_type||''
          const stLabel={morning:'오전',afternoon:'오후',full_9h:'9H',full_12h:'12H'}[st]||st
          const stBg=st?'#fff7ed':'transparent'
          const stFg=st?'#c2410c':'transparent'
          return `<td style="padding:1px;text-align:center;background:${rowBg};border-left:1px solid #e5e7eb">${st?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:4px;background:${stBg};color:${stFg};font-size:9px;font-weight:800">${stLabel}</span>`:''}</td>`
        }).join('')
        const typeLabel=w.worker_type==='dispatch'?'파출':'알바'
        const typeColor=w.worker_type==='dispatch'?'#ea580c':'#db2777'
        return `<tr style="border-bottom:1px solid #fed7aa">
          <td style="padding:4px 8px;min-width:80px;position:sticky;left:0;background:${rowBg};z-index:5;border-right:2px solid #fed7aa">
            <div style="font-size:11px;font-weight:700;color:#1f2937">${w.name}</div>
            <div style="font-size:9px;color:${typeColor};font-weight:600">${typeLabel}</div>
          </td>
          ${cells}
          <td colspan="3" style="padding:2px 8px;background:#fff7ed;border-left:2px solid #fed7aa">
            <span style="font-size:10px;color:${typeColor};font-weight:700">${typeLabel}</span>
          </td>
        </tr>`
      }).join('')
      extSection = `
        <div style="margin-top:2px">
          <div style="background:#fff7ed;border-top:3px solid #ea580c;border-bottom:1px solid #fed7aa;padding:5px 12px;display:flex;align-items:center;gap:7px">
            <i class="fas fa-people-carry" style="color:#ea580c;font-size:12px"></i>
            <span style="font-size:12px;font-weight:800;color:#ea580c">파출 / 알바 외부인력</span>
            <span style="font-size:10px;color:#ea580c;opacity:.7">(${extWorkers.length}명 · 총 ${extWorkDays}일)</span>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <thead>
                <tr style="background:#ea580c">
                  <th style="padding:4px 8px;text-align:left;min-width:80px;position:sticky;left:0;background:#ea580c;z-index:5;color:white;font-size:11px;border-right:2px solid rgba(255,255,255,.3)">이름</th>
                  ${dateRow}
                  <th colspan="3" style="padding:3px 4px;text-align:center;font-size:9px;color:white;border-left:2px solid rgba(255,255,255,.3)">유형</th>
                </tr>
              </thead>
              <tbody>${extRows}</tbody>
            </table>
          </div>
        </div>`
    }

    // 예상급여 요약
    const salaryRows = empStats.filter(e=>e.estimatedSalary!=null).map(e=>{
      const typeLabel={monthly:'월급',hourly:'시급',annual:'연봉'}[e.salary_type||'monthly']||'월급'
      const grp=grouped.find(g=>g.members.some(m=>m.id===e.id))
      const color=grp?.color||'#374151'
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
          <span style="font-size:12px;color:#374151">${e.name}</span>
          <span style="font-size:10px;color:#9ca3af">${e.position_name||e.position||''}</span>
        </div>
        <div style="text-align:right">
          <span style="font-size:12px;font-weight:700;color:#92400e">${e.estimatedSalary.toLocaleString()}원</span>
          <span style="font-size:9px;color:#b45309;margin-left:4px">${typeLabel}</span>
        </div>
      </div>`
    }).join('')

    return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <!-- 요약 KPI -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px">
        <div style="background:linear-gradient(135deg,#166534,#15803d);color:white;border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:900">${emps.length}</div><div style="font-size:9px;opacity:.85">전체 직원</div>
        </div>
        <div style="background:linear-gradient(135deg,#1d4ed8,#2563eb);color:white;border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:900">${avgWork.toFixed(1)}</div><div style="font-size:9px;opacity:.85">평균 근무일</div>
        </div>
        <div style="background:linear-gradient(135deg,#7c3aed,#8b5cf6);color:white;border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:900">${extWorkers.length}</div><div style="font-size:9px;opacity:.85">외부인력</div>
        </div>
        ${showBase && totalSalary>0?`<div style="background:linear-gradient(135deg,#92400e,#b45309);color:white;border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:900">${Math.round(totalSalary/10000)}만</div><div style="font-size:9px;opacity:.85">총 예상급여</div>
        </div>`:''}
      </div>

      <!-- 근무표 (직위별 분리) -->
      <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:700;color:#1f2937"><i class="fas fa-table" style="margin-right:6px;color:#166534"></i>${year}년 ${month}월 직위별 근무현황</div>
          <button onclick="window.print()" style="padding:5px 10px;background:#166534;color:white;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer"><i class="fas fa-print" style="margin-right:3px"></i>출력</button>
        </div>
        <div style="overflow-x:auto;max-height:65vh">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        ${extSection}
      </div>

      <!-- 예상 급여 상세 (운영진 전용 - 급여 공개 설정 ON일 때만) -->
      ${showBase && salaryRows?`
      <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;padding:14px">
        <div style="font-size:13px;font-weight:700;color:#1f2937;margin-bottom:10px"><i class="fas fa-won-sign" style="margin-right:6px;color:#92400e"></i>직원별 예상 급여 (운영진 전용)</div>
        ${salaryRows}
        ${totalSalary>0?`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;margin-top:4px;border-top:2px solid #e5e7eb">
          <span style="font-size:13px;font-weight:800;color:#374151">총 예상 급여</span>
          <span style="font-size:14px;font-weight:900;color:#92400e">${totalSalary.toLocaleString()}원</span>
        </div>`:''}
        <div style="margin-top:8px;padding:8px 12px;background:#fffbeb;border-radius:8px;font-size:10px;color:#92400e"><i class="fas fa-info-circle" style="margin-right:4px"></i>급여는 기본급(월급/시급/연봉 기준)만 산출한 예상치입니다. 수당·공제·세금 별도.</div>
      </div>`:(!showBase && salaryRows?`
      <div style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;padding:14px;text-align:center">
        <i class="fas fa-eye-slash" style="color:#94a3b8;font-size:20px;margin-bottom:8px;display:block"></i>
        <p style="font-size:13px;font-weight:600;color:#64748b;margin:0">급여 정보 비공개</p>
        <p style="font-size:11px;color:#94a3b8;margin:6px 0 0">스케줄 → 근무 설정 → 급여 공개 정책에서 변경 가능합니다</p>
      </div>`:'')}
    </div>
    <style>
      @media print {
        nav, button, .bottom-bar, .month-nav, #toastContainer { display:none!important }
        body { background:white!important; margin:0!important }
        * { -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important }
        div[style*="overflow-x:auto"], div[style*="max-height"] { overflow:visible!important; max-height:none!important }
        div[style*="overflow:hidden"] { overflow:visible!important }
        table { page-break-inside:auto!important }
        tr { page-break-inside:avoid!important }
        thead { display:table-header-group!important }
      }
    </style>`
  } catch(e) {
    console.error('[renderExecStaffScheduleTab]', e)
    return `<div style="padding:20px;color:#b91c1c">인력 근무현황 렌더 오류: ${e.message}</div>`
  }
}

// ── 리스크 알림 배너 ────────────────────────────────────────────
function renderExecRiskBanner(staffLabor, budget) {
  const risks = []

  // 1. 예산 초과 위험
  const pct = budget?.progress || 0
  if (pct >= 100) {
    risks.push({ level: 'danger', icon: 'fa-exclamation-triangle', color: '#dc2626', bg: '#fef2f2', border: '#fecaca',
      msg: `⚠️ 예산 ${pct.toFixed(1)}% 초과 사용 — 즉시 지출 검토가 필요합니다.` })
  } else if (pct >= 85) {
    risks.push({ level: 'warn', icon: 'fa-exclamation-circle', color: '#d97706', bg: '#fffbeb', border: '#fde68a',
      msg: `주의: 예산 ${pct.toFixed(1)}% 사용 — 잔여 예산이 15% 미만입니다.` })
  }

  // 2. 인력 경고 (staffLabor warnings)
  const warnings = staffLabor?.warnings || []
  warnings.forEach(w => {
    risks.push({ level: w.level || 'warn', icon: 'fa-user-minus',
      color: w.level === 'danger' ? '#dc2626' : '#d97706',
      bg: w.level === 'danger' ? '#fef2f2' : '#fffbeb',
      border: w.level === 'danger' ? '#fecaca' : '#fde68a',
      msg: w.message })
  })

  // 3. 인력 부족일 체크 (staffLabor shortageDays)
  const shortageDays = staffLabor?.staffSummary?.shortageDays || 0
  if (shortageDays > 0) {
    risks.push({ level: shortageDays > 5 ? 'danger' : 'warn', icon: 'fa-users-slash',
      color: shortageDays > 5 ? '#dc2626' : '#d97706',
      bg: shortageDays > 5 ? '#fef2f2' : '#fffbeb',
      border: shortageDays > 5 ? '#fecaca' : '#fde68a',
      msg: `이번 달 인력 부족 ${shortageDays}일 — 파출·알바 확충 또는 스케줄 조정이 필요합니다.` })
  }

  if (risks.length === 0) {
    return `<div class="exec-card p-3 flex items-center gap-3" style="background:#f0fdf4;border:1px solid #bbf7d0;margin-bottom:16px">
      <i class="fas fa-check-circle" style="color:#16a34a;font-size:18px;flex-shrink:0"></i>
      <div>
        <span class="font-bold text-sm" style="color:#15803d">이번 달 운영 리스크 없음</span>
        <span class="text-xs ml-2" style="color:#4ade80">예산·인력 모두 정상 범위</span>
      </div>
    </div>`
  }

  return `<div class="exec-card p-4" style="background:#fff7ed;border:1px solid #fed7aa;margin-bottom:16px">
    <div style="font-weight:700;font-size:13px;color:#c2410c;margin-bottom:10px;display:flex;align-items:center;gap:6px">
      <i class="fas fa-exclamation-triangle"></i> 운영 리스크 알림 (${risks.length}건)
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${risks.map(r => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-radius:10px;background:${r.bg};border:1px solid ${r.border}">
        <i class="fas ${r.icon}" style="color:${r.color};font-size:12px;margin-top:2px;flex-shrink:0"></i>
        <span style="font-size:12px;color:${r.color};line-height:1.5">${r.msg}</span>
      </div>`).join('')}
    </div>
  </div>`
}

// ── 리스크 알림 배너 강화 (권고사항 포함, SUMMARY 전용) ──────────────
function renderExecRiskBannerEnhanced(sl, budget, repPrice, targetPrice) {
  const RISK_ADVICE = {
    budget_over:         '즉시 발주 중단 및 지출 전면 검토 필요',
    budget_danger:       '발주량 조정 및 긴급 예산 검토 필요',
    budget_warn:         '잔여 예산 모니터링 강화 필요',
    mealPrice_over_high: '식재료 단가 협상 또는 메뉴 구성 재검토 필요',
    mealPrice_over_low:  '식재료 비용 점검 및 발주처 재협의 권장',
    extRatio_risk:       '정규직 충원 계획 수립 및 인력 구조 개선 권장',
    extRatio_warn:       '외부 인력 의존도 점진적 감소 방안 검토 필요',
    dispatch_risk:       '파출 스케줄 재조정 및 인력 운영 점검 필요',
    dispatch_warn:       '파출 빈도 모니터링 및 정규 스케줄 보완 권장',
    shortage_high:       '파출·알바 즉시 확충 또는 운영 스케줄 재편 필요',
    shortage_low:        '인력 부족일 해소를 위한 추가 인력 배치 검토 권장',
    warning_default:     '운영 현황을 재점검하고 담당 부서에 보고 필요',
  }
  const items = []

  const pct = budget?.progress || 0
  if (pct >= 100) {
    items.push({ level:'risk', mainMsg:`예산 사용률 ${pct.toFixed(1)}% · 예산 초과 상태`, advice: RISK_ADVICE.budget_over })
  } else if (pct >= 95) {
    items.push({ level:'risk', mainMsg:`예산 사용률 ${pct.toFixed(1)}% · 잔여 ${(100-pct).toFixed(1)}% 남음`, advice: RISK_ADVICE.budget_danger })
  } else if (pct >= 85) {
    items.push({ level:'warn', mainMsg:`예산 사용률 ${pct.toFixed(1)}% · 잔여 ${(100-pct).toFixed(1)}% 남음`, advice: RISK_ADVICE.budget_warn })
  }

  if (targetPrice > 0 && repPrice > 0 && repPrice > targetPrice) {
    const over = Math.round(((repPrice-targetPrice)/targetPrice)*100)
    items.push({
      level: over > 5 ? 'risk' : 'warn',
      mainMsg: `식단가 목표 대비 +${over}% 초과 (현재 ${fmtW(Math.round(repPrice))} / 목표 ${fmtW(Math.round(targetPrice))})`,
      advice: over > 5 ? RISK_ADVICE.mealPrice_over_high : RISK_ADVICE.mealPrice_over_low
    })
  }

  const extRatio = State.scoreData?.meta?.externalRatio ?? -1
  if (extRatio >= 60) {
    items.push({ level:'risk', mainMsg:`외부인력 비중 ${extRatio.toFixed(0)}% · 정규직 인력 심각 부족`, advice: RISK_ADVICE.extRatio_risk })
  } else if (extRatio >= 30) {
    items.push({ level:'warn', mainMsg:`외부인력 비중 ${extRatio.toFixed(0)}% · 정규 인력 보강 검토 권장`, advice: RISK_ADVICE.extRatio_warn })
  }

  const ext = sl?.externalSummary
  if (ext) {
    const d = ext.dispatchDays || 0
    if      (d >= 30) items.push({ level:'risk', mainMsg:`파출 ${d}회 · 이번 달 외부 파출 과다`, advice: RISK_ADVICE.dispatch_risk })
    else if (d >= 15) items.push({ level:'warn', mainMsg:`파출 ${d}회 · 파출 빈도 증가 추세`,  advice: RISK_ADVICE.dispatch_warn })
  }

  const shortageDays = sl?.staffSummary?.shortageDays || 0
  if      (shortageDays > 5) items.push({ level:'risk', mainMsg:`인력 부족 ${shortageDays}일 · 운영 공백 발생 위험`, advice: RISK_ADVICE.shortage_high })
  else if (shortageDays > 0) items.push({ level:'warn', mainMsg:`인력 부족 ${shortageDays}일 · 스케줄 조정 필요`,      advice: RISK_ADVICE.shortage_low })

  ;(sl?.warnings || []).forEach(w => {
    const dup = items.some(i => i.mainMsg.includes(w.message?.substring(0,10) || ''))
    if (!dup && w.message) items.push({
      level: w.level === 'danger' ? 'risk' : 'warn',
      mainMsg: w.message, advice: RISK_ADVICE.warning_default
    })
  })

  // ── 이상 없음 ──────────────────────────────────────────────────
  if (items.length === 0) {
    return `
    <div style="background:#f8fffe;border:1px solid #a7f3d0;border-radius:14px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <div style="width:30px;height:30px;background:linear-gradient(135deg,#166534,#16a34a);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas fa-shield-alt" style="color:#fff;font-size:12px"></i>
      </div>
      <div>
        <p style="font-weight:700;font-size:12px;color:#166534;margin:0 0 1px 0">이번 달 운영 리스크 없음</p>
        <p style="font-size:10px;color:#6ee7b7;margin:0">예산·인력·식단가 모두 정상 범위</p>
      </div>
      <div style="margin-left:auto;font-size:18px">✅</div>
    </div>`
  }

  // ── 리스크 존재 (고급 톤) ──────────────────────────────────────
  const riskCount = items.filter(i => i.level==='risk').length
  const warnCount = items.filter(i => i.level==='warn').length
  const hasRisk   = riskCount > 0

  // 헤더: 강렬한 빨강 → 슬레이트 기반의 절제된 톤으로
  const headerBg    = hasRisk
    ? 'linear-gradient(135deg,#1e293b,#374151)'   // 슬레이트 다크 (위험)
    : 'linear-gradient(135deg,#78350f,#92400e)'   // 다크 앰버 (주의)
  const headerBadgeBg = hasRisk ? 'rgba(239,68,68,0.18)' : 'rgba(251,191,36,0.22)'
  const headerBadgeColor = hasRisk ? '#fca5a5' : '#fde68a'
  const headerText = hasRisk ? `⚠ 위험 ${riskCount}건 · 주의 ${warnCount}건` : `⚡ 주의 ${warnCount}건`
  const outerBorder = hasRisk ? '#e2e8f0' : '#fde68a'
  const outerBg     = '#ffffff'

  return `
  <div style="background:${outerBg};border:1px solid ${outerBorder};border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
    <!-- 헤더 -->
    <div style="background:${headerBg};padding:9px 14px;display:flex;align-items:center;gap:8px">
      <i class="fas fa-bell" style="color:#e2e8f0;font-size:11px"></i>
      <span style="font-weight:700;font-size:11px;color:#f1f5f9;letter-spacing:0.04em">운영 리스크 알림</span>
      <span style="margin-left:auto;background:${headerBadgeBg};color:${headerBadgeColor};font-size:10px;font-weight:700;padding:2px 9px;border-radius:99px;letter-spacing:0.03em">${headerText}</span>
    </div>
    <!-- 항목 목록 -->
    <div style="padding:10px 12px;display:flex;flex-direction:column;gap:6px">
      ${items.map(item => {
        const isRisk   = item.level === 'risk'
        // 위험: 슬레이트 배경 + 좌측 강조 바 / 주의: 웜 베이지
        const itemBg     = isRisk ? '#f8f9fb' : '#fffdf5'
        const accentBar  = isRisk ? '#ef4444' : '#f59e0b'
        const msgColor   = isRisk ? '#1e293b' : '#451a03'
        const advColor   = isRisk ? '#64748b' : '#78350f'
        const tagBg      = isRisk ? '#fee2e2' : '#fef9c3'
        const tagColor   = isRisk ? '#dc2626' : '#92400e'
        const tagLabel   = isRisk ? '위험' : '주의'
        return `
        <div style="background:${itemBg};border-radius:10px;padding:9px 11px;display:flex;gap:10px;align-items:flex-start;border-left:3px solid ${accentBar}">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <span style="background:${tagBg};color:${tagColor};font-size:9px;font-weight:700;padding:1px 7px;border-radius:99px;flex-shrink:0">${tagLabel}</span>
              <p style="font-weight:700;font-size:11px;color:${msgColor};margin:0;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.mainMsg}</p>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px;padding-left:1px">
              <i class="fas fa-arrow-right" style="color:${advColor};font-size:8px;margin-top:3px;flex-shrink:0"></i>
              <p style="font-size:10px;color:${advColor};margin:0;line-height:1.5">${item.advice}</p>
            </div>
          </div>
        </div>`
      }).join('')}
    </div>
    <!-- 하단 버튼 -->
    <div style="padding:0 12px 10px">
      <button onclick="openModal('risk')" style="width:100%;padding:7px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.03em;transition:background 0.15s"
        onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
        전체 리스크 상세 확인 →
      </button>
    </div>
  </div>`
}

// ── 인건비 구성 도넛 차트 ─────────────────────────────────────────
function initLaborDonutChart(d) {
  const canvas = document.getElementById('execLaborDonutChart')
  if (!canvas || !d) return
  const lc = d.laborCost || {}
  const showBase = d.showBaseSalary === true

  // 기본급 비공개 시 기본급 항목 제외
  const allItems = [
    ...(showBase ? [{ label: '기본급', val: lc.baseSalary || 0, color: '#818cf8' }] : []),
    { label: 'OT수당',  val: lc.otCost        || 0, color: '#fbbf24' },
    { label: '파출비',  val: lc.dispatchCost  || 0, color: '#fb923c' },
    { label: '알바비',  val: lc.parttimeCost  || 0, color: '#facc15' },
  ]
  const data = allItems.filter(item => item.val > 0)
  if (data.length === 0) return

  // 분모: 표시 항목 합계
  const displaySum = data.reduce((s, item) => s + item.val, 0) || 1

  // Chart.js 도넛 차트 (CDN 로드 확인)
  if (typeof Chart === 'undefined') return
  // 기존 차트 제거
  const existing = Chart.getChart(canvas)
  if (existing) existing.destroy()
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        data: data.map(d => d.val),
        backgroundColor: data.map(d => d.color),
        borderWidth: 2,
        borderColor: '#fff',
      }]
    },
    options: {
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = ((ctx.parsed / displaySum) * 100).toFixed(1)
              const val = ctx.parsed >= 10000
                ? `${Math.round(ctx.parsed/10000)}만원`
                : `${ctx.parsed.toLocaleString()}원`
              return ` ${ctx.label}: ${val} (${pct}%)`
            }
          }
        }
      },
      animation: { duration: 400 }
    }
  })
}

// ══════════════════════════════════════════════════════════════════
// ── Drill-down 모달 ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

window.openModal = function(type) {
  closeModal()
  const d = State.data || {}
  const budget = d.budget || {}
  const dp = d.dietPrices || {}
  const sl = State.staffLabor || {}
  const mealStats = d.mealStats || {}
  const vendorOrders = d.vendorOrders || []
  const scoreData = State.scoreData || {}
  const totalMeals = dp.totalMeals || mealStats.totalMeals || 0

  let html = ''
  if (type === 'budget')   html = modalBudget(budget, d, vendorOrders)
  if (type === 'mealPrice') html = modalMealPrice(dp, budget)
  if (type === 'labor')    html = modalLabor(sl)
  if (type === 'risk')     html = modalRisk(sl, budget, dp, d)
  if (type === 'meals')    html = modalMeals(mealStats, d, totalMeals)
  if (type === 'score')    html = modalScore(scoreData)

  const overlay = document.createElement('div')
  overlay.id = 'execModalOverlay'
  overlay.className = 'exec-modal-overlay'
  overlay.innerHTML = `<div class="exec-modal-box">${html}</div>`
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal() })
  document.body.appendChild(overlay)
}

window.closeModal = function() {
  const el = document.getElementById('execModalOverlay')
  if (el) el.remove()
}

window.modalGoTab = function(tab) {
  closeModal()
  window.execSetViewStyle('DETAIL')
  setTimeout(() => {
    if (typeof execSwitchTab === 'function') execSwitchTab(tab)
    const el = document.getElementById('execTab-' + tab)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, 150)
}

// 모달 공통 헤더
function modalHeader(icon, title, color) {
  return `
  <div style="background:${color};border-radius:20px 20px 0 0;padding:20px 24px 16px">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
          <i class="fas ${icon} text-white"></i>
        </div>
        <h2 class="text-white font-bold text-lg">${title}</h2>
      </div>
      <button onclick="closeModal()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition">
        <i class="fas fa-times text-sm"></i>
      </button>
    </div>
  </div>`
}

function modalRow(label, value, valueColor) {
  return `<div class="flex items-center justify-between py-2 border-b border-gray-100">
    <span class="text-sm text-gray-500">${label}</span>
    <span class="text-sm font-bold" style="color:${valueColor||'#1e293b'}">${value}</span>
  </div>`
}

// ① 예산 모달
function modalBudget(budget, d, vendorOrders) {
  const pct = budget.progress || 0
  const remaining = (budget.totalBudget||0) - (budget.totalUsed||0)
  const dp = d.dietPrices || {}
  const foodUsed = dp.foodUsed || 0
  const supplyUsed = dp.supplyUsed || 0
  const cardUsed = dp.cardUsed || 0
  const eventUsed = dp.eventExpensesTotal || 0
  const yStr = String(State.year)
  const mStr = String(State.month).padStart(2,'0')
  return `
  ${modalHeader('fa-wallet','예산 상태 상세','linear-gradient(135deg,#1e40af,#3b82f6)')}
  <div class="p-6">
    <div class="mb-4">
      ${modalRow('총 예산', fmtW(budget.totalBudget))}
      ${modalRow('사용 금액', fmtW(budget.totalUsed), pct>=100?'#dc2626':pct>=85?'#d97706':'#15803d')}
      ${modalRow('잔여 예산', fmtW(remaining), remaining<0?'#dc2626':'#15803d')}
      ${modalRow('사용률', pct.toFixed(1)+'%', pct>=100?'#dc2626':pct>=85?'#d97706':'#15803d')}
    </div>
    <div class="progress-bar mb-4"><div class="progress-fill" style="width:${Math.min(pct,100)}%;background:${pct>=100?'#dc2626':pct>=85?'#d97706':'#16a34a'}"></div></div>
    <h4 class="text-xs font-bold text-gray-400 uppercase mb-2">비용 항목별 분해</h4>
    ${modalRow('식재료비', fmtW(foodUsed), '#1e293b')}
    ${modalRow('소모품비', fmtW(supplyUsed), '#7c3aed')}
    ${modalRow('법인카드', fmtW(d.cardTotal||0), '#0891b2')}
    ${modalRow('이벤트 비용', fmtW(eventUsed), '#d97706')}
    <div class="flex gap-2 mt-5">
      <button onclick="modalGoTab('overview')" class="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition" style="background:#1e40af">
        <i class="fas fa-chart-pie mr-1"></i>상세 보기
      </button>
      <a href="/api/executive/export/budget/${yStr}/${mStr}" download
        class="flex-1 py-2.5 rounded-xl text-sm font-semibold text-center text-white transition" style="background:#16a34a">
        <i class="fas fa-download mr-1"></i>CSV 다운로드
      </a>
    </div>
  </div>`
}

// ② 식단가 모달
function modalMealPrice(dp, budget) {
  const rep    = dp.representative || 0
  const target = budget.targetMealPrice || 0
  const oper   = dp.operating || 0
  const patient = dp.patient || 0
  const diff   = target > 0 ? rep - target : null
  const diffColor = diff === null ? '#9ca3af' : diff > 0 ? '#dc2626' : '#16a34a'
  return `
  ${modalHeader('fa-utensils','식단가 상태 상세','linear-gradient(135deg,#166534,#16a34a)')}
  <div class="p-6">
    ${modalRow('대표 식단가', fmtW(rep), '#1e293b')}
    ${modalRow('목표 식단가', target>0?fmtW(target):'미설정', '#9ca3af')}
    ${diff!==null ? modalRow('목표 대비', (diff>0?'+':'')+fmtW(diff), diffColor) : ''}
    ${modalRow('운영비 포함 식단가', fmtW(oper), '#7c3aed')}
    ${patient>0 ? modalRow('환자 식단가', fmtW(patient), '#0891b2') : ''}
    <div class="mt-4 p-3 rounded-xl" style="background:#f0fdf4;border:1px solid #bbf7d0">
      <p class="text-xs text-green-700 leading-relaxed">
        <strong>대표 식단가</strong> = 순수 식재료비(food cost_type) ÷ 기준 식수<br>
        <strong>운영비 포함</strong> = 전체 발주금액 ÷ 기준 식수<br>
        <strong>환자 식단가</strong> = 식재료비 ÷ 환자 전용 식수
      </p>
    </div>
  </div>`
}

// ③ 인력 안정도 모달
function modalLabor(sl) {
  if (!sl || !sl.staffSummary) return `
  ${modalHeader('fa-user-friends','인력 안정도 상세','linear-gradient(135deg,#4f46e5,#7c3aed)')}
  <div class="p-6 text-center text-gray-400">
    <i class="fas fa-inbox text-4xl mb-3 block"></i>
    <p>인력 데이터가 없습니다.</p>
    <button onclick="closeModal()" class="mt-4 px-6 py-2 rounded-xl text-sm font-semibold text-white" style="background:#4f46e5">닫기</button>
  </div>`
  const ss = sl.staffSummary || {}
  const ext = sl.externalSummary || {}
  const lc  = sl.laborCost || {}
  const extRatio = State.scoreData?.meta?.externalRatio ?? -1
  const yStr = String(State.year)
  const mStr = String(State.month).padStart(2,'0')
  return `
  ${modalHeader('fa-user-friends','인력 안정도 상세','linear-gradient(135deg,#4f46e5,#7c3aed)')}
  <div class="p-6">
    <h4 class="text-xs font-bold text-gray-400 uppercase mb-2">인력 현황</h4>
    ${modalRow('전체 직원 수', ss.total+'명')}
    ${modalRow('정규직', (ss.fullTime||0)+'명')}
    ${modalRow('파트타임·계약직', ((ss.total||0)-(ss.fullTime||0))+'명')}
    ${extRatio >= 0 ? modalRow('외부인력 비중', extRatio.toFixed(1)+'%', extRatio>=60?'#dc2626':extRatio>=30?'#d97706':'#16a34a') : ''}
    <h4 class="text-xs font-bold text-gray-400 uppercase mb-2 mt-4">외부인력 투입</h4>
    ${modalRow('파출 투입 횟수', (ext.dispatchDays||0)+'회', (ext.dispatchDays||0)>=30?'#dc2626':'#1e293b')}
    ${modalRow('알바 투입 횟수', (ext.parttimeDays||0)+'회')}
    <h4 class="text-xs font-bold text-gray-400 uppercase mb-2 mt-4">인건비</h4>
    ${modalRow('파출비', fmtW(lc.dispatchCost||0), '#7c3aed')}
    ${modalRow('알바비', fmtW(lc.parttimeCost||0), '#0891b2')}
    <div class="flex gap-2 mt-5">
      <button onclick="modalGoTab('staffsched')" class="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition" style="background:#4f46e5">
        <i class="fas fa-calendar mr-1"></i>근무표 보기
      </button>
      <a href="/api/executive/export/labor/${yStr}/${mStr}" download
        class="flex-1 py-2.5 rounded-xl text-sm font-semibold text-center text-white transition" style="background:#16a34a">
        <i class="fas fa-download mr-1"></i>CSV 다운로드
      </a>
    </div>
  </div>`
}

// ④ 운영 리스크 모달
function modalRisk(sl, budget, dp, d) {
  const risks = []
  const pct = budget.progress || 0
  const repPrice = dp.representative || 0
  const targetPrice = budget.targetMealPrice || 0
  if (pct >= 100)     risks.push({ level:'risk', msg:`예산 사용률 ${pct.toFixed(1)}% — 즉시 지출 검토 필요` })
  else if (pct >= 95) risks.push({ level:'risk', msg:`예산 사용률 ${pct.toFixed(1)}% — 위험 수준` })
  else if (pct >= 85) risks.push({ level:'warn', msg:`예산 사용률 ${pct.toFixed(1)}% — 잔여 15% 미만` })
  if (targetPrice > 0 && repPrice > targetPrice) {
    const over = Math.round(((repPrice-targetPrice)/targetPrice)*100)
    risks.push({ level: over>5?'risk':'warn', msg:`대표 식단가 목표 대비 +${over}% 초과` })
  }
  const extRatio = State.scoreData?.meta?.externalRatio ?? -1
  if (extRatio >= 60) risks.push({ level:'risk', msg:`외부인력 비중 ${extRatio.toFixed(0)}%` })
  else if (extRatio >= 30) risks.push({ level:'warn', msg:`외부인력 비중 ${extRatio.toFixed(0)}% — 주의` })
  const ext = sl?.externalSummary || {}
  if ((ext.dispatchDays||0) >= 30) risks.push({ level:'risk', msg:`파출 ${ext.dispatchDays}회 — 과다` })
  ;(sl?.warnings||[]).forEach(w => risks.push({ level:w.level||'warn', msg:w.message }))
  return `
  ${modalHeader('fa-exclamation-triangle','운영 리스크 현황',risks.length===0?'linear-gradient(135deg,#166534,#16a34a)':'linear-gradient(135deg,#991b1b,#ef4444)')}
  <div class="p-6">
    ${risks.length === 0
      ? `<div class="text-center py-6">
           <i class="fas fa-check-circle text-4xl text-green-500 mb-3 block"></i>
           <p class="font-bold text-green-700">이번 달 운영 리스크 없음</p>
           <p class="text-sm text-gray-400 mt-1">예산·인력·식단가 모두 정상 범위입니다.</p>
         </div>`
      : risks.map(r => `
        <div class="flex items-start gap-3 p-3 rounded-xl mb-2" style="background:${r.level==='risk'?'#fef2f2':'#fffbeb'};border:1px solid ${r.level==='risk'?'#fecaca':'#fde68a'}">
          <i class="fas fa-${r.level==='risk'?'times-circle':'exclamation-circle'} mt-0.5 flex-shrink-0" style="color:${r.level==='risk'?'#dc2626':'#d97706'}"></i>
          <span class="text-sm" style="color:${r.level==='risk'?'#991b1b':'#92400e'}">${r.msg}</span>
        </div>`).join('')
    }
    <button onclick="closeModal()" class="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold text-white" style="background:#374151">닫기</button>
  </div>`
}

// ⑤ 식수 모달
function modalMeals(mealStats, d, totalMeals) {
  const total = totalMeals || 0
  const days  = mealStats.daysEntered || 0
  const avg   = days > 0 ? Math.round(total / days) : 0
  const staff  = mealStats.total_staff || 0
  const guardian = mealStats.total_guardian || 0
  const patientMeals = Math.max(0, total - staff - guardian)
  const patientPct = total > 0 ? ((patientMeals/total)*100).toFixed(1) : '0.0'
  const staffPct   = total > 0 ? ((staff/total)*100).toFixed(1) : '0.0'
  const guardianPct= total > 0 ? ((guardian/total)*100).toFixed(1) : '0.0'
  return `
  ${modalHeader('fa-utensils','식수 현황 상세','linear-gradient(135deg,#92400e,#d97706)')}
  <div class="p-6">
    ${modalRow('총 식수', fmt(total)+'식')}
    ${modalRow('입력 일수', days+'일')}
    ${modalRow('일 평균 식수', fmt(avg)+'식')}
    <h4 class="text-xs font-bold text-gray-400 uppercase mb-2 mt-4">식수 구성</h4>
    ${patientMeals>0?modalRow('환자식', fmt(patientMeals)+'식 ('+patientPct+'%)'):''}
    ${staff>0?modalRow('직원식', fmt(staff)+'식 ('+staffPct+'%)'):''}
    ${guardian>0?modalRow('보호자식', fmt(guardian)+'식 ('+guardianPct+'%)'):''}
    ${total === 0 ? `<p class="text-center text-sm text-gray-400 py-4">이번 달 식수 데이터가 없습니다.</p>` : ''}
    <button onclick="closeModal()" class="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold text-white" style="background:#d97706">닫기</button>
  </div>`
}

// ⑥ 종합점수 모달
function modalScore(scoreData) {
  if (!scoreData || !scoreData.available) {
    const reason = scoreData?.reason || '당월 데이터가 부족합니다.'
    return `
    ${modalHeader('fa-star','운영 종합 점수','linear-gradient(135deg,#374151,#6b7280)')}
    <div class="p-6 text-center">
      <div style="font-size:40px;font-weight:900;color:#9ca3af;margin-bottom:8px">N/A</div>
      <p class="font-bold text-gray-500 mb-2">산정불가</p>
      <p class="text-sm text-gray-400">${reason}</p>
      <button onclick="closeModal()" class="mt-5 px-6 py-2 rounded-xl text-sm font-semibold text-white" style="background:#374151">닫기</button>
    </div>`
  }
  const score = scoreData.totalScore || 0
  const grade = scoreData.grade || '-'
  const gradeColor = grade==='A'?'#16a34a':grade==='B'?'#2563eb':grade==='C'?'#d97706':'#dc2626'
  const gradeBg    = `linear-gradient(135deg,${grade==='A'?'#166534,#16a34a':grade==='B'?'#1e3a8a,#2563eb':grade==='C'?'#92400e,#d97706':'#991b1b,#ef4444'})`
  const bd = scoreData.breakdown || {}

  function scoreBar(item, max) {
    if (!item) return ''
    const s = item.score
    const isNA = item.na || s === null || s === undefined
    const pct = isNA ? 0 : Math.round((s/max)*100)
    const barColor = pct>=80?'#16a34a':pct>=50?'#d97706':'#dc2626'
    return `
    <div class="mb-3">
      <div class="flex justify-between mb-1">
        <span class="text-xs font-semibold text-gray-600">${item.label}</span>
        <span class="text-xs font-bold" style="color:${isNA?'#9ca3af':barColor}">${isNA?'N/A':s+'/'+max+'점'}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="text-xs text-gray-400 mt-1">${item.detail||''}</div>
    </div>`
  }

  const recs = scoreData.recommendations || []
  return `
  ${modalHeader('fa-star','운영 종합 점수',gradeBg)}
  <div class="p-6">
    <div class="text-center mb-5">
      <div style="font-size:52px;font-weight:900;color:${gradeColor};line-height:1">${score}</div>
      <div style="font-size:13px;color:#64748b;margin-top:2px">점 / 100점</div>
      <div style="display:inline-block;margin-top:8px;padding:4px 18px;border-radius:99px;background:${gradeColor};color:#fff;font-size:16px;font-weight:800">${grade} 등급</div>
    </div>
    <h4 class="text-xs font-bold text-gray-400 uppercase mb-3">항목별 점수</h4>
    ${scoreBar(bd.budget, 35)}
    ${scoreBar(bd.mealPrice, 30)}
    ${scoreBar(bd.labor, 20)}
    ${scoreBar(bd.risk, 15)}
    ${recs.length > 0 ? `
    <h4 class="text-xs font-bold text-gray-400 uppercase mb-2 mt-4">개선 권고사항</h4>
    ${recs.map(r=>`<div class="flex items-start gap-2 mb-2 p-2.5 rounded-lg" style="background:#f8fafc;border:1px solid #e2e8f0">
      <i class="fas fa-lightbulb text-amber-400 flex-shrink-0 mt-0.5 text-xs"></i>
      <p class="text-xs text-gray-600 leading-relaxed">${r}</p>
    </div>`).join('')}` : ''}
    <button onclick="closeModal()" class="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold text-white" style="background:${gradeColor}">닫기</button>
  </div>`
}

})()
