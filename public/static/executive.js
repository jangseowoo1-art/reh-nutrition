// ── executive.js ── 운영진 전용 대시보드
// 버전: 20260321

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
  activeTab: 'overview',
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
    const [summary, annual, staffLabor] = await Promise.all([
      api('GET', `/api/executive/summary/${yStr}/${mStr}`),
      api('GET', `/api/executive/annual/${yStr}`),
      api('GET', `/api/executive/staff-labor/${yStr}/${mStr}`).catch(() => null)
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

// ── 전체 렌더 ─────────────────────────────────────────────────────
function renderAll() {
  const content = document.getElementById('execContent')
  if (!content) return

  const d = State.data
  const budget = d.budget || {}
  const mealStats = d.mealStats || {}
  const vendorOrders = d.vendorOrders || []
  const cardExpenses = d.cardExpenses || []
  const transactions = d.transactions || []
  const schedules = d.schedules || []
  const catOrders = d.catOrders || []
  const inspection = d.inspectionStats || {}
  const prevMonth = d.prevMonth || {}

  // 파생값
  const progressPct = budget.progress || 0
  const currentMealPrice = budget.currentMealPrice || 0
  const prevMealPrice = prevMonth.mealPrice || 0
  const mealDiff = currentMealPrice - prevMealPrice

  content.innerHTML = `
    <!-- KPI 카드 그리드 -->
    <div class="grid grid-cols-2 gap-4" style="grid-template-columns: repeat(2, 1fr)" id="kpiGrid">
      ${kpiCard('fa-wallet', '예산 사용', fmtW(budget.totalUsed), fmtW(budget.totalBudget), progressPct, progressColor(progressPct), 'gradient-blue')}
      ${kpiCard('fa-utensils', '식단가', fmtW(currentMealPrice), `목표 ${fmtW(budget.targetMealPrice||0)}`, null, null, 'gradient-green', mealDiff !== 0 ? `전월비 ${mealDiff > 0 ? '+' : ''}${fmtW(mealDiff)}` : '전월 동일')}
      ${kpiCard('fa-users', '총 식수', fmt(mealStats.totalMeals)+'식', `${mealStats.daysEntered || 0}일 입력`, null, null, 'gradient-amber')}
      ${kpiCard('fa-search', '검수 현황', `${inspection.completed||0}/${inspection.total_orders||0}`, `이슈 ${inspection.issues||0}건`, inspection.total_orders > 0 ? Math.round((inspection.completed||0)/(inspection.total_orders||1)*100) : 100, '#16a34a', 'gradient-purple')}
    </div>

    <!-- 예산 진행 상태 -->
    ${renderBudgetSection(budget, prevMonth)}

    <!-- 탭 네비게이션 -->
    <div class="exec-card p-0 overflow-hidden">
      <div class="flex border-b border-gray-100 overflow-x-auto" id="execTabBar">
        ${['overview','vendors','meals','card','transactions','schedule'].map((t,i) => {
          const labels = ['종합 현황','업체별 발주','식수 현황','법인카드','지출결의서','납품 스케줄']
          const icons = ['fa-chart-pie','fa-truck','fa-utensils','fa-credit-card','fa-file-invoice','fa-calendar-alt']
          return `<button onclick="execSwitchTab('${t}')" id="execTab-${t}"
            class="flex-shrink-0 flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition whitespace-nowrap ${State.activeTab===t ? 'tab-active' : 'text-gray-500 hover:text-gray-800'}">
            <i class="fas ${icons[i]} text-xs"></i>${labels[i]}
          </button>`
        }).join('')}
      </div>
      <div class="p-4 md:p-6" id="execTabContent">
        ${renderTabContent(State.activeTab, vendorOrders, mealStats, cardExpenses, transactions, schedules, catOrders, budget)}
      </div>
    </div>

    <!-- 인력 & 인건비 현황 -->
    ${renderExecStaffLaborSection(State.staffLabor)}

    <!-- 연간 추이 차트 -->
    ${renderAnnualSection()}
  `

  // 차트 초기화
  setTimeout(() => {
    initBudgetGaugeChart(progressPct)
    initAnnualChart()
    initVendorChart(vendorOrders)
  }, 100)
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
  document.querySelectorAll('[id^="execTab-"]').forEach(el => {
    const t = el.id.replace('execTab-','')
    el.classList.toggle('tab-active', t === tab)
    el.classList.toggle('text-gray-500', t !== tab)
    el.classList.remove('text-gray-800')
    if (t !== tab) el.classList.add('text-gray-500')
  })
  const d = State.data
  const content = document.getElementById('execTabContent')
  if (!content || !d) return
  content.innerHTML = renderTabContent(tab,
    d.vendorOrders||[], d.mealStats||{}, d.cardExpenses||[],
    d.transactions||[], d.schedules||[], d.catOrders||[], d.budget||{},
    d.mealFieldBreakdown||[], d.prevMonth||{})
  // 차트 재초기화
  if (tab === 'vendors') setTimeout(() => initVendorChart(d.vendorOrders||[]), 100)
}

function renderTabContent(tab, vendorOrders, mealStats, cardExpenses, transactions, schedules, catOrders, budget, mealFieldBreakdown, prevMonthData) {
  switch(tab) {
    case 'overview': return renderOverviewTab(vendorOrders, mealStats, catOrders, budget, mealFieldBreakdown, prevMonthData)
    case 'vendors': return renderVendorsTab(vendorOrders, budget)
    case 'meals': return renderMealsTab(mealStats, mealFieldBreakdown, prevMonthData)
    case 'card': return renderCardTab(cardExpenses)
    case 'transactions': return renderTransactionsTab(transactions)
    case 'schedule': return renderScheduleTab(schedules)
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
  const baseRatio     = Math.round(((lc.baseSalary  || 0) / totalLC) * 100)
  const otRatio       = Math.round(((lc.otCost      || 0) / totalLC) * 100)
  const dispatchRatio = Math.round(((lc.dispatchCost|| 0) / totalLC) * 100)
  const parttimeRatio = Math.round(((lc.parttimeCost|| 0) / totalLC) * 100)
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
    { label:'기본급',       val: lc.baseSalary   || 0, ratio: baseRatio,     color:'#818cf8' },
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
          <p style="font-size:28px;font-weight:800">${fmtW2(lc.total)}<span style="font-size:14px;font-weight:400;margin-left:4px">원</span></p>
          <p style="font-size:11px;color:#c7d2fe;margin-top:4px">기본급 + OT + 파출 + 알바 합산</p>
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
      </div>
    </div>
  </div>`
}

})()
