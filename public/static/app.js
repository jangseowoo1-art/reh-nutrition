// ══════════════════════════════════════════════════════════════
//  병원 급식 예산 관리 - 메인 앱 JS v2.0
// ══════════════════════════════════════════════════════════════

const App = {
  token: localStorage.getItem('token'),
  role: localStorage.getItem('role'),
  hospitalName: localStorage.getItem('hospitalName'),
  username: localStorage.getItem('username'),
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  currentPage: '',
  charts: {}
}

// ── 초기화 ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (!App.token) { window.location.href = '/login'; return }
  initSidebar()
  const path = window.location.pathname
  const pageMap = {
    '/dashboard': 'dashboard', '/': 'dashboard',
    '/orders': 'orders', '/meals': 'meals',
    '/schedule': 'schedule', '/analysis': 'analysis',
    '/settings': 'settings', '/admin': 'admin'
  }
  navigateTo(pageMap[path] || 'dashboard')
})

function initSidebar() {
  document.getElementById('hospitalNameDisplay').textContent = App.hospitalName || '병원'
  document.getElementById('usernameDisplay').textContent = App.username
  document.getElementById('roleDisplay').textContent = App.role === 'admin' ? '관리자' : '영양사'
  updateMonthDisplay()
  const menus = App.role === 'admin' ? getAdminMenus() : getHospitalMenus()
  document.getElementById('menuContainer').innerHTML = menus.map(renderMenuItem).join('')
  // 관리자면 알림 배지 로드
  if (App.role === 'admin') loadNotificationBadge()
}

async function loadNotificationBadge() {
  const data = await api('GET', '/api/admin/notifications')
  if (!data) return
  const cnt = data.unreadCount || 0
  // 병원 관리 메뉴에 배지 추가/업데이트
  const menuEl = document.getElementById('menu-hospital-manage')
  if (menuEl) {
    const existing = menuEl.querySelector('.notif-badge')
    if (cnt > 0) {
      if (existing) {
        existing.textContent = cnt > 9 ? '9+' : cnt
      } else {
        const badge = document.createElement('span')
        badge.className = 'notif-badge ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold'
        badge.textContent = cnt > 9 ? '9+' : cnt
        menuEl.appendChild(badge)
      }
    } else {
      // 읽지 않은 알림이 없으면 배지 제거
      if (existing) existing.remove()
    }
  }
  App.unreadNotifCount = cnt
}

function getHospitalMenus() {
  return [
    { id: 'dashboard', icon: 'fa-chart-line', label: '월별 대시보드', section: '현황' },
    { id: 'orders', icon: 'fa-clipboard-list', label: '발주 입력', section: null },
    { id: 'meals', icon: 'fa-utensils', label: '식수 입력', section: null },
    { id: 'schedule', icon: 'fa-calendar-alt', label: '스케줄 관리', section: null },
    { id: 'analysis', icon: 'fa-chart-bar', label: '연간 분석', section: '분석' },
    { id: 'settings', icon: 'fa-cog', label: '설정', section: '관리' }
  ]
}

function getAdminMenus() {
  return [
    { id: 'admin', icon: 'fa-th-large', label: '전체 현황', section: '관리자' },
    { id: 'hospital-manage', icon: 'fa-hospital', label: '병원 관리', section: null },
    { id: 'holiday-manage', icon: 'fa-calendar-times', label: '공휴일 관리', section: null },
    { id: 'analysis', icon: 'fa-chart-bar', label: '비교 분석', section: '분석' },
    { id: 'report', icon: 'fa-file-pdf', label: '보고서 출력', section: null }
  ]
}

function renderMenuItem(item) {
  const sectionHtml = item.section ? `<div class="menu-section-title">${item.section}</div>` : ''
  return `${sectionHtml}
  <div class="menu-item" id="menu-${item.id}" onclick="navigateTo('${item.id}')">
    <div class="icon"><i class="fas ${item.icon} text-xs"></i></div>
    <span>${item.label}</span>
  </div>`
}

function updateMonthDisplay() {
  const m = `${App.currentYear}년 ${App.currentMonth}월`
  const el1 = document.getElementById('currentMonthDisplay')
  const el2 = document.getElementById('headerMonth')
  if (el1) el1.textContent = m
  if (el2) el2.textContent = m
}

function navigateTo(page) {
  App.currentPage = page
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'))
  const activeMenu = document.getElementById(`menu-${page}`)
  if (activeMenu) activeMenu.classList.add('active')

  const titles = {
    dashboard: { title: '월별 대시보드', sub: '예산 현황 및 업체별 진행률' },
    orders: { title: '발주 입력', sub: '일별 업체별 발주금액 입력' },
    meals: { title: '식수 입력', sub: '조식/중식/석식 식수 현황' },
    schedule: { title: '스케줄 관리', sub: '직원 근무 스케줄' },
    analysis: { title: '연간 분석', sub: '월별 비교 및 추이 그래프' },
    settings: { title: '설정', sub: '업체 관리 및 목표금액 설정' },
    admin: { title: '전체 병원 현황', sub: '관리자 - 실시간 모니터링' },
    'hospital-manage': { title: '병원 관리', sub: '병원 정보 및 예산 설정' },
    'holiday-manage': { title: '공휴일 관리', sub: '공휴일 조회 및 수동 추가' },
    report: { title: '보고서 출력', sub: 'PPT/PDF 월별 리포트' }
  }

  const t = titles[page] || { title: page, sub: '' }
  const titleEl = document.getElementById('pageTitle')
  const subEl = document.getElementById('pageSubtitle')
  if (titleEl) titleEl.textContent = t.title
  if (subEl) subEl.textContent = t.sub

  Object.values(App.charts).forEach(c => c?.destroy?.())
  App.charts = {}

  const pages = {
    dashboard: renderDashboard, orders: renderOrders, meals: renderMeals,
    schedule: renderSchedule, analysis: renderAnalysis,
    settings: renderSettings, admin: renderAdminDashboard,
    'hospital-manage': renderHospitalManage,
    'holiday-manage': renderHolidayManage,
    report: renderReport
  }

  if (pages[page]) pages[page]()
  else document.getElementById('pageContent').innerHTML = '<div class="text-center text-gray-400 py-20">준비 중입니다</div>'
  
  history.pushState(null, '', `/${page === 'dashboard' ? '' : page}`)
}

function changeMonth(delta) {
  App.currentMonth += delta
  if (App.currentMonth > 12) { App.currentMonth = 1; App.currentYear++ }
  if (App.currentMonth < 1) { App.currentMonth = 12; App.currentYear-- }
  updateMonthDisplay()
  navigateTo(App.currentPage)
}

async function api(method, url, data = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` }
    }
    if (data) opts.body = JSON.stringify(data)
    const res = await fetch(url, opts)
    if (res.status === 401) { logout(); return null }
    return await res.json()
  } catch(e) { console.error('API Error:', e); return null }
}

function fmt(n) { return (n || 0).toLocaleString('ko-KR') }
function fmtWon(n) { return `${(n || 0).toLocaleString('ko-KR')}원` }
function fmtMan(n) { return n >= 10000 ? `${Math.round(n/10000)}만` : `${n}` }
function getProgressColor(pct) {
  if (pct >= 100) return 'progress-red'
  if (pct >= 80) return 'progress-yellow'
  return 'progress-green'
}
function getBadgeColor(pct) {
  if (pct >= 100) return 'badge-red'
  if (pct >= 80) return 'badge-yellow'
  return 'badge-green'
}
function getDaysInMonth(year, month) { return new Date(year, month, 0).getDate() }
function getDayOfWeek(year, month, day) {
  return ['일','월','화','수','목','금','토'][new Date(year, month-1, day).getDay()]
}
function isWeekend(year, month, day) {
  const d = new Date(year, month-1, day).getDay()
  return d === 0 || d === 6
}
function getCategoryColor(cat) {
  const map = { major:'bg-blue-400', meat:'bg-red-400', seafood:'bg-cyan-400', fruit:'bg-yellow-400',
    organic:'bg-green-400', delivery:'bg-purple-400', market:'bg-orange-400', event:'bg-pink-400', card:'bg-gray-400' }
  return map[cat] || 'bg-gray-300'
}
function getCategoryLabel(cat) {
  const map = { major:'대기업급식', meat:'육류', seafood:'해산물', fruit:'청과', organic:'유기농',
    delivery:'인터넷배송', market:'시장', event:'이벤트', card:'법인카드', general:'기타' }
  return map[cat] || '기타'
}
function getTaxTypeLabel(t) {
  return { mixed:'과세+면세', taxable:'과세', exempt:'면세' }[t] || t
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':type==='error'?'fa-times-circle':'fa-exclamation-triangle'}"></i> ${msg}`
  document.body.appendChild(t)
  setTimeout(() => t.classList.add('fade-out'), 2700)
  setTimeout(() => t.remove(), 3000)
}

function logout() { localStorage.clear(); window.location.href = '/login' }

// ══════════════════════════════════════════════════════════════
//  대시보드 페이지 (v2.0)
// ══════════════════════════════════════════════════════════════
async function renderDashboard() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const data = await api('GET', `/api/dashboard/summary/${App.currentYear}/${App.currentMonth}`)
  if (!data) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  const s = data.summary
  const vendors = data.vendors || []
  const ms = data.mealStats || {}
  const totalMeals = (ms.total_patient||0)+(ms.total_staff||0)+(ms.total_noncovered||0)+(ms.total_guardian||0)
  const mealPrice = totalMeals > 0 && s.totalUsed > 0 ? Math.round(s.totalUsed / totalMeals) : (data.settings?.meal_price || 0)
  const overBudget = data.overBudgetVendors || []
  
  // 현재 날짜 기준 남은 일수 계산
  const today = new Date()
  const isCurrentMonth = today.getFullYear() === App.currentYear && (today.getMonth()+1) === App.currentMonth
  const daysInMonth = getDaysInMonth(App.currentYear, App.currentMonth)
  const currentDay = isCurrentMonth ? today.getDate() : daysInMonth
  const remainingDays = daysInMonth - currentDay

  content.innerHTML = `
  <!-- 예산 초과 알림 -->
  ${overBudget.length > 0 ? `
  <div class="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
    <div class="flex items-center gap-2 mb-2">
      <i class="fas fa-exclamation-triangle text-red-500"></i>
      <span class="font-bold text-red-700">예산 초과 알림 (${overBudget.length}개 업체)</span>
    </div>
    <div class="flex flex-wrap gap-2">
      ${overBudget.map(v => `
        <div class="bg-red-100 text-red-700 px-3 py-1 rounded-lg text-sm font-medium">
          ${v.name}: ${fmt(v.total_used)}원 / ${fmt(v.monthly_budget)}원 
          (+${fmt(v.total_used - v.monthly_budget)}원 초과)
        </div>
      `).join('')}
    </div>
  </div>` : ''}

  <!-- 상단 요약 카드 4개 -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">월 사용금액</span>
        <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <i class="fas fa-won-sign text-blue-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold text-gray-800">${fmtMan(s.totalUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400 mt-1">목표: ${fmtMan(s.totalBudget)}원</div>
      <div class="mt-2 progress-bar">
        <div class="progress-fill ${getProgressColor(parseFloat(s.progress))}" style="width:${Math.min(parseFloat(s.progress),100)}%"></div>
      </div>
      <div class="mt-1 text-xs font-semibold ${parseFloat(s.progress)>=100?'text-red-600':parseFloat(s.progress)>=80?'text-yellow-600':'text-green-600'}">${s.progress}%</div>
    </div>

    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">잔여 예산</span>
        <div class="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
          <i class="fas fa-piggy-bank text-purple-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold ${s.remaining<0?'text-red-600':'text-gray-800'}">${fmtMan(Math.abs(s.remaining))}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs ${s.remaining<0?'text-red-500':'text-gray-400'} mt-1">${s.remaining<0?'⚠️ 예산 초과!':'남은 예산'}</div>
      <div class="text-xs text-gray-400 mt-1">잔여 ${remainingDays}일 · 일평균 ${fmtMan(remainingDays>0?Math.round(s.remaining/remainingDays):0)}원 가능</div>
    </div>

    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">오늘 발주</span>
        <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
          <i class="fas fa-calendar-day text-green-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold ${parseFloat(s.todayProgress)>=100?'text-red-600':parseFloat(s.todayProgress)>=80?'text-yellow-600':'text-gray-800'}">${fmtMan(s.todayUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400 mt-1">일 목표: ${fmtMan(s.dailyBudget)}원</div>
      <div class="mt-2 progress-bar">
        <div class="progress-fill ${getProgressColor(parseFloat(s.todayProgress))}" style="width:${Math.min(parseFloat(s.todayProgress||0),100)}%"></div>
      </div>
      <div class="mt-1 text-xs text-gray-500">${s.todayProgress}%</div>
    </div>

    <div class="stat-card">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">이번 주</span>
        <div class="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
          <i class="fas fa-calendar-week text-orange-500 text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold ${parseFloat(s.weekProgress)>=100?'text-red-600':parseFloat(s.weekProgress)>=80?'text-yellow-600':'text-gray-800'}">${fmtMan(s.weekUsed)}<span class="text-xs font-normal text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400 mt-1">주 목표: ${fmtMan(s.weeklyBudget)}원</div>
      <div class="mt-2 progress-bar">
        <div class="progress-fill ${getProgressColor(parseFloat(s.weekProgress))}" style="width:${Math.min(parseFloat(s.weekProgress||0),100)}%"></div>
      </div>
      <div class="mt-1 text-xs text-gray-500">${s.weekProgress}%</div>
    </div>
  </div>

  <!-- 업체별 진행률 + 일별 차트 -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
    <!-- 업체별 진행률 -->
    <div class="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 class="font-bold text-gray-800">업체별 예산 현황</h2>
        <button onclick="navigateTo('orders')" class="text-xs text-blue-500 hover:underline flex items-center gap-1">
          <i class="fas fa-edit"></i> 발주 입력 →
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>업체명</th>
              <th class="text-right">사용금액</th>
              <th class="text-right">목표금액</th>
              <th style="width:160px">진행률</th>
              <th class="text-right">잔여</th>
            </tr>
          </thead>
          <tbody>
            ${vendors.map(v => {
              const pct = v.monthly_budget > 0 ? ((v.total_used / v.monthly_budget) * 100) : null
              const remaining = v.monthly_budget - v.total_used
              const over = v.monthly_budget > 0 && v.total_used > v.monthly_budget
              return `<tr>
                <td>
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full flex-shrink-0 ${getCategoryColor(v.category)}"></span>
                    <span class="font-medium text-sm">${v.name}</span>
                    ${over ? '<span class="badge badge-red" style="font-size:10px">초과</span>' : ''}
                  </div>
                  <div class="text-xs text-gray-400 ml-4">${getCategoryLabel(v.category)} · ${getTaxTypeLabel(v.tax_type)}</div>
                </td>
                <td class="text-right font-semibold text-sm">${fmt(v.total_used)}</td>
                <td class="text-right text-gray-500 text-sm">${v.monthly_budget > 0 ? fmt(v.monthly_budget) : '무제한'}</td>
                <td>
                  ${pct !== null ? `
                  <div class="flex items-center gap-2">
                    <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div class="h-full rounded-full ${getProgressColor(pct)}" style="width:${Math.min(pct,100)}%"></div>
                    </div>
                    <span class="text-xs w-10 text-right ${over?'text-red-600 font-bold':'text-gray-600'}">${pct.toFixed(1)}%</span>
                  </div>` : '<span class="text-xs text-gray-300">-</span>'}
                </td>
                <td class="text-right text-sm ${remaining<0?'text-red-500 font-semibold':'text-gray-500'}">${v.monthly_budget>0?fmt(remaining):'-'}</td>
              </tr>`
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="bg-gray-50 font-bold">
              <td class="text-sm">합계</td>
              <td class="text-right text-blue-700">${fmt(s.totalUsed)}</td>
              <td class="text-right text-gray-600">${fmt(s.totalBudget)}</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full rounded-full ${getProgressColor(parseFloat(s.progress))}" style="width:${Math.min(parseFloat(s.progress),100)}%"></div>
                  </div>
                  <span class="text-xs w-10 text-right">${s.progress}%</span>
                </div>
              </td>
              <td class="text-right ${s.remaining<0?'text-red-600':'text-green-700'}">${fmt(s.remaining)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- 일별 누적 발주 차트 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col">
      <h2 class="font-bold text-gray-800 mb-1">일별 누적 발주</h2>
      <p class="text-xs text-gray-400 mb-3">누적 vs 목표금액</p>
      <div class="flex-1 min-h-0">
        <canvas id="dailyChart"></canvas>
      </div>
    </div>
  </div>

  <!-- 식수 현황 + 업체 카테고리 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-gray-800">이번달 식수 현황</h2>
        <button onclick="navigateTo('meals')" class="text-xs text-blue-500 hover:underline">식수 입력 →</button>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-4">
        ${[
          { label: '환자식', value: ms.total_patient, color: 'bg-blue-100 text-blue-700', icon: 'fa-bed' },
          { label: '직원식', value: ms.total_staff, color: 'bg-green-100 text-green-700', icon: 'fa-user' },
          { label: '비급여', value: ms.total_noncovered, color: 'bg-purple-100 text-purple-700', icon: 'fa-receipt' },
          { label: '보호자', value: ms.total_guardian, color: 'bg-orange-100 text-orange-700', icon: 'fa-users' }
        ].map(item => `
          <div class="flex items-center gap-3 p-3 rounded-xl ${item.color.split(' ')[0]}">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center ${item.color}">
              <i class="fas ${item.icon} text-xs"></i>
            </div>
            <div>
              <div class="text-xs font-medium opacity-75">${item.label}</div>
              <div class="font-bold text-lg">${fmt(item.value)}<span class="text-xs font-normal opacity-60 ml-1">식</span></div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
        <span class="text-sm font-medium text-gray-600">총 식수</span>
        <span class="font-bold text-lg text-gray-800">${fmt(totalMeals)}<span class="text-xs font-normal text-gray-400 ml-1">식</span></span>
      </div>
      ${totalMeals > 0 ? `
      <div class="flex items-center justify-between p-3 mt-2 bg-blue-50 rounded-xl">
        <span class="text-sm font-medium text-blue-600">실제 식단가</span>
        <span class="font-bold text-lg text-blue-700">${fmt(mealPrice)}<span class="text-xs font-normal ml-1">원/식</span></span>
      </div>` : ''}
    </div>

    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 mb-4">업체 카테고리별 비중</h2>
      <canvas id="vendorPieChart" style="max-height:200px"></canvas>
    </div>
  </div>`

  // 일별 누적 차트 (daysInMonth는 위에서 이미 선언됨)
  const dailyMap = {}
  ;(data.dailyOrders || []).forEach(d => {
    const day = parseInt(d.order_date.split('-')[2]) - 1
    dailyMap[day] = d.daily_total
  })
  let cumulative = 0
  const cumulativeData = []
  for (let i = 0; i < daysInMonth; i++) {
    cumulative += dailyMap[i] || 0
    cumulativeData.push(cumulative)
  }
  const ctx1 = document.getElementById('dailyChart')
  if (ctx1) {
    App.charts.daily = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: Array.from({ length: daysInMonth }, (_, i) => `${i+1}`),
        datasets: [{
          label: '누적 발주액',
          data: cumulativeData,
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22,163,74,0.08)',
          fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2
        }, {
          label: '목표금액',
          data: Array(daysInMonth).fill(s.totalBudget),
          borderColor: '#ef4444',
          borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, fill: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { ticks: { callback: v => `${(v/10000).toFixed(0)}만`, font: { size: 10 } } }
        }
      }
    })
  }

  // 파이 차트
  const catData = {}
  vendors.forEach(v => {
    if (v.total_used > 0) {
      const cat = getCategoryLabel(v.category)
      catData[cat] = (catData[cat] || 0) + v.total_used
    }
  })
  const ctx2 = document.getElementById('vendorPieChart')
  if (ctx2 && Object.keys(catData).length > 0) {
    App.charts.pie = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: Object.keys(catData),
        datasets: [{ data: Object.values(catData), backgroundColor: ['#16a34a','#15803d','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'] }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}원` } }
        }
      }
    })
  }
}

// ══════════════════════════════════════════════════════════════
//  발주 입력 페이지 (v2.0 - 다일치 발주 지원)
// ══════════════════════════════════════════════════════════════
async function renderOrders() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const [vendors, orderData, settingsData] = await Promise.all([
    api('GET', '/api/vendors'),
    api('GET', `/api/orders/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/settings/${App.currentYear}/${App.currentMonth}`)
  ])

  if (!vendors) { content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'; return }

  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  const orderMap = {}
  ;(orderData || []).forEach(o => {
    if (!orderMap[o.order_date]) orderMap[o.order_date] = {}
    orderMap[o.order_date][o.vendor_id] = o
  })

  const settings = settingsData?.settings || {}
  const totalBudget = settings.total_budget || 0
  const workingDays = settings.working_days || getDaysInMonth(App.currentYear, App.currentMonth)
  const dailyBudget = workingDays > 0 ? Math.round(totalBudget / workingDays) : 0

  // 오늘 날짜 계산
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const todayDay = (today.getFullYear() === App.currentYear && today.getMonth()+1 === App.currentMonth) ? today.getDate() : days

  // 이번 주 시작/끝 (월요일 기준)
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1))
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  // 금액 계산
  const monthTotal = (orderData||[]).reduce((s,o) => s+(o.total_amount||0), 0)

  let todayTotal = 0, weekTotal = 0
  ;(orderData||[]).forEach(o => {
    if (o.order_date === todayStr) todayTotal += o.total_amount||0
    const od = new Date(o.order_date)
    if (od >= weekStart && od <= weekEnd) weekTotal += o.total_amount||0
  })

  // 주간 예산 = 일일예산 × 5일(영업일)
  const weekBudget = dailyBudget * 5

  const monthPct = totalBudget > 0 ? Math.round(monthTotal / totalBudget * 100) : 0
  const todayPct = dailyBudget > 0 ? Math.round(todayTotal / dailyBudget * 100) : 0
  const weekPct = weekBudget > 0 ? Math.round(weekTotal / weekBudget * 100) : 0

  function pctColor(p) { return p >= 100 ? 'text-red-600' : p >= 80 ? 'text-yellow-600' : 'text-green-700' }
  function barColor(p) { return p >= 100 ? 'progress-red' : p >= 80 ? 'progress-yellow' : 'progress-green' }

  content.innerHTML = `
  <!-- ── 예산 진행률 실시간 패널 ── -->
  <div id="budgetProgressPanel" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-bold text-gray-700 text-sm"><i class="fas fa-tachometer-alt text-green-600 mr-1"></i>예산 달성 현황 (실시간)</h3>
      <span class="text-xs text-gray-400">${App.currentYear}년 ${App.currentMonth}월 | 월 총예산: <strong class="text-gray-700">${fmtWon(totalBudget)}</strong></span>
    </div>
    <div class="grid grid-cols-3 gap-4">
      <div class="bg-gray-50 rounded-xl p-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-gray-500">일별 발주</span>
          <span class="text-xs font-bold ${pctColor(todayPct)}" id="todayPct">${todayPct}%</span>
        </div>
        <div class="progress-bar h-2 mb-1"><div id="todayBar" class="progress-fill ${barColor(todayPct)}" style="width:${Math.min(todayPct,100)}%"></div></div>
        <div class="flex justify-between text-xs text-gray-400">
          <span id="todayAmt">${fmtWon(todayTotal)}</span>
          <span>목표: ${fmtWon(dailyBudget)}</span>
        </div>
      </div>
      <div class="bg-gray-50 rounded-xl p-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-gray-500">주별 발주</span>
          <span class="text-xs font-bold ${pctColor(weekPct)}" id="weekPct">${weekPct}%</span>
        </div>
        <div class="progress-bar h-2 mb-1"><div id="weekBar" class="progress-fill ${barColor(weekPct)}" style="width:${Math.min(weekPct,100)}%"></div></div>
        <div class="flex justify-between text-xs text-gray-400">
          <span id="weekAmt">${fmtWon(weekTotal)}</span>
          <span>목표: ${fmtWon(weekBudget)}</span>
        </div>
      </div>
      <div class="bg-gray-50 rounded-xl p-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-gray-500">월별 발주</span>
          <span class="text-xs font-bold ${pctColor(monthPct)}" id="monthPct">${monthPct}%</span>
        </div>
        <div class="progress-bar h-2 mb-1"><div id="monthBar" class="progress-fill ${barColor(monthPct)}" style="width:${Math.min(monthPct,100)}%"></div></div>
        <div class="flex justify-between text-xs text-gray-400">
          <span id="monthAmt">${fmtWon(monthTotal)}</span>
          <span>목표: ${fmtWon(totalBudget)}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800">${App.currentYear}년 ${App.currentMonth}월 발주 입력</h2>
        <p class="text-xs text-gray-400 mt-0.5">업체별 과세/면세 금액 입력 후 자동 저장 | 주말/공휴일 다수일 발주 시 하단 버튼 사용</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="showQuickMultiDay()" class="btn btn-primary btn-sm">
          <i class="fas fa-calendar-plus mr-1"></i> 다수일 발주 입력
        </button>
        <button onclick="refreshOrders()" class="btn btn-secondary btn-sm">
          <i class="fas fa-sync"></i> 새로고침
        </button>
      </div>
    </div>
    
    <!-- 월별 업체 합계 요약 -->
    <div class="px-5 py-3 border-b border-gray-100 bg-gray-50 overflow-x-auto">
      <div class="flex gap-3 min-w-max text-xs" id="vendorSummaryRow">
        ${vendors.map(v => {
          const vOrders = (orderData || []).filter(o => o.vendor_id === v.id)
          const vTotal = vOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
          const pct = v.monthly_budget > 0 ? (vTotal / v.monthly_budget * 100).toFixed(0) : null
          const over = v.monthly_budget > 0 && vTotal > v.monthly_budget
          return `<div class="flex flex-col items-center min-w-[80px] p-2 bg-white rounded-lg border ${over?'border-red-200':'border-gray-200'}">
            <div class="font-semibold text-gray-700 text-center leading-tight mb-1" style="font-size:11px">${v.name.length > 6 ? v.name.substring(0,6)+'…' : v.name}</div>
            <div class="font-bold ${over?'text-red-600':'text-green-700'}">${fmtMan(vTotal)}</div>
            ${pct ? `<div class="${over?'text-red-400':'text-gray-400'}">${pct}%</div>` : ''}
          </div>`
        }).join('')}
        <div class="flex flex-col items-center min-w-[80px] p-2 bg-green-50 rounded-lg border border-green-200">
          <div class="font-semibold text-green-700 mb-1" style="font-size:11px">월 합계</div>
          <div class="font-bold text-green-700" id="monthTotalDisplay">${fmtMan((orderData||[]).reduce((s,o)=>s+(o.total_amount||0),0))}</div>
          ${totalBudget > 0 ? `<div class="text-gray-400" id="monthPctDisplay">${monthPct}%</div>` : ''}
        </div>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="order-table w-full" id="ordersTable">
        <thead>
          <tr>
            <th rowspan="2" class="sticky left-0 z-10 bg-gray-800" style="min-width:50px">일</th>
            <th rowspan="2" style="min-width:28px">요일</th>
            <th rowspan="2" style="min-width:50px;font-size:10px">발주<br>일수</th>
            ${vendors.map(v => `
              <th colspan="${getVendorCols(v.tax_type)}" style="min-width:${getVendorCols(v.tax_type)*90}px">
                <div style="font-size:11px">${v.name}</div>
                <div style="font-size:9px;opacity:0.7">${getTaxTypeLabel(v.tax_type)}</div>
              </th>
            `).join('')}
            <th rowspan="2" style="min-width:90px">일 합계</th>
          </tr>
          <tr>
            ${vendors.map(v => getVendorSubHeaders(v.tax_type)).join('')}
          </tr>
        </thead>
        <tbody>
          ${Array.from({ length: days }, (_, i) => {
            const day = i + 1
            const dow = getDayOfWeek(App.currentYear, App.currentMonth, day)
            const weekend = isWeekend(App.currentYear, App.currentMonth, day)
            const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const rowClass = dow === '일' ? 'holiday-row' : weekend ? 'weekend-row' : ''
            let dayTotal = 0
            ;(orderData||[]).filter(o=>o.order_date===dateStr).forEach(o=>dayTotal+=o.total_amount||0)
            // 다일치 여부 확인
            const dayOrders = (orderData||[]).filter(o=>o.order_date===dateStr)
            const multiDayInfo = dayOrders.find(o=>o.is_multi_day)
            const multiDayCount = multiDayInfo ? (() => {
              const s = new Date(multiDayInfo.multi_day_start), e = new Date(multiDayInfo.multi_day_end)
              return Math.round((e-s)/(1000*60*60*24))+1
            })() : 1
            return `<tr class="${rowClass}" data-date="${dateStr}">
              <td class="date-col sticky left-0 z-10">${day}</td>
              <td class="text-center" style="font-size:11px;font-weight:${weekend?'bold':'normal'};color:${dow==='토'?'#16a34a':dow==='일'?'#ef4444':'#6b7280'}">${dow}</td>
              <td class="text-center" style="font-size:10px">
                <select class="multiday-select" data-date="${dateStr}" style="border:1px solid #e5e7eb;border-radius:4px;padding:1px 2px;font-size:10px;background:#f9fafb;cursor:pointer;" onchange="updateMultiDayNote(this)">
                  ${[1,2,3,4,5,6,7].map(n => `<option value="${n}" ${multiDayCount===n?'selected':''}>${n}일</option>`).join('')}
                </select>
              </td>
              ${vendors.map(v => getVendorInputCells(v, orderMap[dateStr]?.[v.id]||{}, dateStr)).join('')}
              <td class="total-col text-right pr-2 text-xs" id="dayTotal-${dateStr}">${dayTotal>0?fmt(dayTotal):''}</td>
            </tr>`
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="bg-gray-100 font-bold text-xs">
            <td colspan="3" class="text-center py-2 sticky left-0 bg-gray-100">합계</td>
            ${vendors.map(v => getVendorTotalCells(v, orderData||[])).join('')}
            <td class="text-right pr-2 text-green-700 font-bold">
              ${fmt((orderData||[]).reduce((s,o)=>s+(o.total_amount||0),0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- 다수일 발주 빠른 입력 패널 -->
  <div id="quickMultiDayPanel" class="hidden bg-white rounded-2xl shadow-sm border border-green-200 p-5 mt-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800"><i class="fas fa-calendar-plus text-green-600 mr-2"></i>다수일 발주 입력 (주말·공휴일·명절)</h3>
      <button onclick="document.getElementById('quickMultiDayPanel').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
    </div>
    <div class="bg-green-50 rounded-xl p-3 mb-4 text-xs text-green-800">
      <i class="fas fa-info-circle mr-1"></i>
      주말·공휴일이 포함된 다수일 발주를 넣을 때 사용합니다. 시작일에 N일치 금액을 한 번에 입력합니다.
    </div>
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">발주 날짜 (시작일)</label>
        <input type="date" id="qdStart" class="form-input" value="${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}">
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">발주 일수</label>
        <div class="flex gap-2">
          ${[2,3,4,5,6,7].map(n => `<button onclick="selectQDDays(${n})" id="qdBtn${n}" class="px-3 py-2 rounded-lg border text-sm font-medium ${n===2?'bg-green-600 text-white border-green-600':'bg-white text-gray-600 border-gray-300'} hover:bg-green-50">${n}일</button>`).join('')}
          <input type="number" id="qdDays" class="form-input text-center" style="width:60px" value="2" min="1" max="14" onchange="syncQDButtons(this.value)">
        </div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">업체 선택</label>
        <select id="qdVendor" class="form-input">
          ${vendors.map(v => `<option value="${v.id}" data-taxtype="${v.tax_type}">${v.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">비고 (자동입력)</label>
        <input type="text" id="qdNote" class="form-input" placeholder="예: 설 연휴 3일치" id="qdNote">
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">과세금액 (원)</label>
        <input type="number" id="qdTaxable" class="form-input" placeholder="0" min="0">
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">면세금액 (원)</label>
        <input type="number" id="qdExempt" class="form-input" placeholder="0" min="0">
      </div>
    </div>
    <div class="flex gap-3">
      <button onclick="saveQuickMultiDay()" class="btn btn-primary flex-1"><i class="fas fa-save mr-1"></i>다수일 발주 저장</button>
      <button onclick="document.getElementById('quickMultiDayPanel').classList.add('hidden')" class="btn btn-secondary">취소</button>
    </div>
  </div>`

  // 전역에 예산 데이터 저장 (실시간 업데이트용)
  window._ordersBudget = { totalBudget, dailyBudget, weekBudget, todayStr, weekStart, weekEnd }
  window._ordersData = orderData || []

  bindOrderInputEvents()
}

window.showQuickMultiDay = () => {
  document.getElementById('quickMultiDayPanel').classList.remove('hidden')
  document.getElementById('quickMultiDayPanel').scrollIntoView({ behavior: 'smooth' })
}

window.selectQDDays = (n) => {
  document.getElementById('qdDays').value = n
  ;[2,3,4,5,6,7].forEach(x => {
    const btn = document.getElementById(`qdBtn${x}`)
    if (btn) btn.className = `px-3 py-2 rounded-lg border text-sm font-medium ${x===n?'bg-green-600 text-white border-green-600':'bg-white text-gray-600 border-gray-300'} hover:bg-green-50`
  })
  // 비고 자동 업데이트
  const noteEl = document.getElementById('qdNote')
  if (noteEl && !noteEl.value) noteEl.placeholder = `${n}일치 발주`
}

window.syncQDButtons = (v) => window.selectQDDays(parseInt(v))

window.updateMultiDayNote = (sel) => {
  // 발주일수 변경 시 해당 행의 다일치 정보 업데이트 (시각적 표시만)
  const days = parseInt(sel.value)
  const dateStr = sel.dataset.date
  const row = document.querySelector(`tr[data-date="${dateStr}"]`)
  if (row) {
    row.style.background = days > 1 ? 'rgba(22,163,74,0.05)' : ''
  }
}

window.saveQuickMultiDay = async () => {
  const start = document.getElementById('qdStart').value
  const days = parseInt(document.getElementById('qdDays').value) || 2
  const vendorId = parseInt(document.getElementById('qdVendor').value)
  const taxable = parseInt(document.getElementById('qdTaxable').value || 0) || 0
  const exempt = parseInt(document.getElementById('qdExempt').value || 0) || 0
  const note = document.getElementById('qdNote').value || `${days}일치 발주`
  const vat = Math.round(taxable * 0.1)

  if (!start) { showToast('시작일을 선택하세요', 'error'); return }
  if (taxable === 0 && exempt === 0) { showToast('금액을 입력하세요', 'error'); return }

  // 종료일 계산
  const endDate = new Date(start)
  endDate.setDate(endDate.getDate() + days - 1)
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`

  const res = await api('POST', '/api/orders/save', {
    vendorId, orderDate: start, taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat,
    note: note, isMultiDay: 1, multiDayStart: start, multiDayEnd: end
  })

  if (res?.success) {
    document.getElementById('quickMultiDayPanel').classList.add('hidden')
    showToast(`${start} ~ ${end} (${days}일치) 발주 저장 완료!`, 'success')
    renderOrders()
  } else {
    showToast('저장 실패', 'error')
  }
}

window.refreshOrders = () => renderOrders()

function getVendorCols(taxType) { return taxType === 'mixed' ? 3 : 1 }

function getVendorSubHeaders(taxType) {
  if (taxType === 'mixed') return `<th style="min-width:80px;font-size:10px">과세</th><th style="min-width:80px;font-size:10px">면세</th><th style="min-width:80px;font-size:10px;background:#1a2f4a">소계</th>`
  if (taxType === 'taxable') return `<th style="min-width:80px;font-size:10px">과세</th>`
  return `<th style="min-width:80px;font-size:10px">면세</th>`
}

function getVendorInputCells(v, order, dateStr) {
  const taxable = order.taxable_amount || 0
  const exempt = order.exempt_amount || 0
  const total = order.total_amount || 0
  const multiDay = order.is_multi_day ? `title="${order.multi_day_start}~${order.multi_day_end} 다일치"` : ''
  if (v.tax_type === 'mixed') {
    return `<td><input type="number" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${taxable||''}" placeholder="0" min="0"></td>
            <td><input type="number" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${exempt||''}" placeholder="0" min="0"></td>
            <td class="total-col text-right pr-2 text-xs ${order.is_multi_day?'multi-day-cell':''}" id="vt-${v.id}-${dateStr}" ${multiDay}>${total>0?fmt(total):''}</td>`
  }
  if (v.tax_type === 'taxable') {
    return `<td><input type="number" class="order-input" data-vendor="${v.id}" data-type="taxable" data-date="${dateStr}" value="${taxable||''}" placeholder="0" min="0"></td>`
  }
  return `<td><input type="number" class="order-input" data-vendor="${v.id}" data-type="exempt" data-date="${dateStr}" value="${exempt||''}" placeholder="0" min="0"></td>`
}

function getVendorTotalCells(v, orderData) {
  const filtered = orderData.filter(o => o.vendor_id === v.id)
  const totalTaxable = filtered.reduce((s, o) => s + (o.taxable_amount||0), 0)
  const totalExempt = filtered.reduce((s, o) => s + (o.exempt_amount||0), 0)
  const total = filtered.reduce((s, o) => s + (o.total_amount||0), 0)
  if (v.tax_type === 'mixed') {
    return `<td class="text-right pr-1 text-xs">${totalTaxable>0?fmt(totalTaxable):''}</td>
            <td class="text-right pr-1 text-xs">${totalExempt>0?fmt(totalExempt):''}</td>
            <td class="text-right pr-2 text-blue-700 font-bold text-xs total-col">${total>0?fmt(total):''}</td>`
  }
  return `<td class="text-right pr-2 text-blue-700 font-bold text-xs total-col">${total>0?fmt(total):''}</td>`
}

function bindOrderInputEvents() {
  document.querySelectorAll('.order-input').forEach(input => {
    input.addEventListener('change', async function() {
      const vendorId = this.dataset.vendor
      const date = this.dataset.date
      const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
      const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
      const taxable = parseInt(taxableEl?.value||0)||0
      const exempt = parseInt(exemptEl?.value||0)||0
      const vat = Math.round(taxable * 0.1)
      const total = taxable + exempt + vat
      const subtotalEl = document.getElementById(`vt-${vendorId}-${date}`)
      if (subtotalEl) subtotalEl.textContent = total > 0 ? fmt(total) : ''
      updateDayTotal(date)
      await api('POST', '/api/orders/save', {
        vendorId: parseInt(vendorId), orderDate: date,
        taxableAmount: taxable, exemptAmount: exempt, vatAmount: vat
      })
      updateBudgetProgressPanel()
    })
    // 엔터키로 다음 셀 이동
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        const inputs = [...document.querySelectorAll('.order-input')]
        const idx = inputs.indexOf(this)
        if (idx < inputs.length-1) { e.preventDefault(); inputs[idx+1].focus() }
      }
    })
  })
}

function updateBudgetProgressPanel() {
  // 전체 입력값 합계 재계산
  const budget = window._ordersBudget
  if (!budget) return
  const { totalBudget, dailyBudget, weekBudget, todayStr, weekStart, weekEnd } = budget

  let monthTotal = 0, todayTotal = 0, weekTotal = 0
  const allInputs = document.querySelectorAll('.order-input')
  const processed = {}
  allInputs.forEach(inp => {
    const date = inp.dataset.date
    const vendor = inp.dataset.vendor
    const key = `${date}-${vendor}`
    if (processed[key]) return
    processed[key] = true
    const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendor}"][data-type="exempt"][data-date="${date}"]`)
    const t = parseInt(taxableEl?.value||0)||0
    const e = parseInt(exemptEl?.value||0)||0
    const total = t + Math.round(t*0.1) + e
    monthTotal += total
    if (date === todayStr) todayTotal += total
    const od = new Date(date)
    if (od >= weekStart && od <= weekEnd) weekTotal += total
  })

  const monthPct = totalBudget > 0 ? Math.round(monthTotal / totalBudget * 100) : 0
  const todayPct = dailyBudget > 0 ? Math.round(todayTotal / dailyBudget * 100) : 0
  const weekPct = weekBudget > 0 ? Math.round(weekTotal / weekBudget * 100) : 0

  function pctColor(p) { return p >= 100 ? 'text-red-600' : p >= 80 ? 'text-yellow-600' : 'text-green-700' }
  function barColor(p) { return p >= 100 ? '#ef4444' : p >= 80 ? '#f59e0b' : '#16a34a' }

  const updateEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
  const updateBar = (id, pct, color) => {
    const el = document.getElementById(id)
    if (el) { el.style.width = `${Math.min(pct,100)}%`; el.style.background = color }
  }
  const updateClass = (id, cls) => {
    const el = document.getElementById(id)
    if (el) { el.className = `text-xs font-bold ${cls}` }
  }

  updateEl('todayPct', `${todayPct}%`); updateEl('todayAmt', fmtWon(todayTotal))
  updateEl('weekPct', `${weekPct}%`); updateEl('weekAmt', fmtWon(weekTotal))
  updateEl('monthPct', `${monthPct}%`); updateEl('monthAmt', fmtWon(monthTotal))
  updateBar('todayBar', todayPct, barColor(todayPct))
  updateBar('weekBar', weekPct, barColor(weekPct))
  updateBar('monthBar', monthPct, barColor(monthPct))
  updateClass('todayPct', pctColor(todayPct))
  updateClass('weekPct', pctColor(weekPct))
  updateClass('monthPct', pctColor(monthPct))

  // 월 합계 표시 업데이트
  const mTotalEl = document.getElementById('monthTotalDisplay')
  const mPctEl = document.getElementById('monthPctDisplay')
  if (mTotalEl) mTotalEl.textContent = fmtMan(monthTotal)
  if (mPctEl) mPctEl.textContent = `${monthPct}%`
}

function updateDayTotal(date) {
  let total = 0
  const processedVendors = new Set()
  document.querySelectorAll(`.order-input[data-date="${date}"]`).forEach(inp => {
    const vendorId = inp.dataset.vendor
    if (processedVendors.has(vendorId)) return
    processedVendors.add(vendorId)
    const taxableEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="taxable"][data-date="${date}"]`)
    const exemptEl = document.querySelector(`input.order-input[data-vendor="${vendorId}"][data-type="exempt"][data-date="${date}"]`)
    const t = parseInt(taxableEl?.value||0)||0
    const e = parseInt(exemptEl?.value||0)||0
    total += t + Math.round(t*0.1) + e
  })
  const el = document.getElementById(`dayTotal-${date}`)
  if (el) el.textContent = total > 0 ? fmt(total) : ''
}

// ══════════════════════════════════════════════════════════════
//  식수 입력 페이지
// ══════════════════════════════════════════════════════════════
async function renderMeals() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const mealData = await api('GET', `/api/meals/${App.currentYear}/${App.currentMonth}`)
  if (!mealData) return

  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  const mealMap = {}
  mealData.forEach(m => { mealMap[m.meal_date] = m })

  // 월 합계 계산
  let monthTotal = { p:0, s:0, n:0, g:0 }
  mealData.forEach(m => {
    monthTotal.p += (m.breakfast_patient||0)+(m.lunch_patient||0)+(m.dinner_patient||0)
    monthTotal.s += (m.breakfast_staff||0)+(m.lunch_staff||0)+(m.dinner_staff||0)
    monthTotal.n += (m.breakfast_noncovered||0)+(m.lunch_noncovered||0)+(m.dinner_noncovered||0)
    monthTotal.g += (m.breakfast_guardian||0)+(m.lunch_guardian||0)+(m.dinner_guardian||0)
  })

  content.innerHTML = `
  <!-- 월 합계 요약 -->
  <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
    ${[
      { label: '환자식', val: monthTotal.p, color: 'blue' },
      { label: '직원식', val: monthTotal.s, color: 'green' },
      { label: '비급여', val: monthTotal.n, color: 'purple' },
      { label: '보호자', val: monthTotal.g, color: 'orange' },
      { label: '총 식수', val: monthTotal.p+monthTotal.s+monthTotal.n+monthTotal.g, color: 'gray', bold: true }
    ].map(item => `
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-center">
        <div class="text-xs text-gray-500 font-medium mb-1">${item.label}</div>
        <div class="text-xl font-bold text-${item.color}-600">${fmt(item.val)}</div>
        <div class="text-xs text-gray-400">식</div>
      </div>
    `).join('')}
  </div>

  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800">${App.currentYear}년 ${App.currentMonth}월 식수 현황</h2>
        <p class="text-xs text-gray-400 mt-0.5">조식/중식/석식 × 환자·직원·비급여·보호자</p>
      </div>
      <button onclick="saveMealBatch()" class="btn btn-success btn-sm">
        <i class="fas fa-save"></i> 전체 저장
      </button>
    </div>
    <div class="overflow-x-auto">
      <table class="meal-table w-full" style="font-size:12px">
        <thead>
          <tr>
            <th rowspan="2" style="min-width:32px">일</th>
            <th rowspan="2" style="min-width:24px">요</th>
            <th colspan="5" class="border-l-2 border-blue-700">조식</th>
            <th colspan="5" class="border-l-2 border-green-700">중식</th>
            <th colspan="5" class="border-l-2 border-purple-700">석식</th>
            <th colspan="5" class="border-l-2 border-gray-600" style="background:#0f2942">합계</th>
          </tr>
          <tr>
            ${['bf','l','d','t'].map((prefix, mi) => {
              const colors = ['border-blue-700','border-green-700','border-purple-700','border-gray-600']
              const bg = mi===3 ? 'background:#0f2942' : ''
              return `
                <th class="border-l-2 ${colors[mi]}" style="${bg}">환자</th>
                <th style="${bg}">직원</th>
                <th style="${bg}">비급</th>
                <th style="${bg}">보호</th>
                <th style="${bg};background:${mi===3?'#0f2942':'#1e3a6e'};color:#93c5fd">합</th>
              `
            }).join('')}
          </tr>
        </thead>
        <tbody id="mealTableBody">
          ${Array.from({ length: days }, (_, i) => {
            const day = i + 1
            const dow = getDayOfWeek(App.currentYear, App.currentMonth, day)
            const weekend = isWeekend(App.currentYear, App.currentMonth, day)
            const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const m = mealMap[dateStr] || {}
            const rowClass = dow==='일'?'holiday-row':weekend?'weekend-row':''
            const bp=m.breakfast_patient||0, bs=m.breakfast_staff||0, bn=m.breakfast_noncovered||0, bg2=m.breakfast_guardian||0
            const lp=m.lunch_patient||0, ls=m.lunch_staff||0, ln=m.lunch_noncovered||0, lg=m.lunch_guardian||0
            const dp=m.dinner_patient||0, ds=m.dinner_staff||0, dn=m.dinner_noncovered||0, dg=m.dinner_guardian||0
            return `<tr class="${rowClass}" data-date="${dateStr}">
              <td class="font-semibold text-center">${day}</td>
              <td class="text-center ${dow==='토'?'text-blue-600 font-bold':dow==='일'?'text-red-600 font-bold':''}">${dow}</td>
              ${makeMealInput('bf_p',dateStr,bp)} ${makeMealInput('bf_s',dateStr,bs)} ${makeMealInput('bf_n',dateStr,bn)} ${makeMealInput('bf_g',dateStr,bg2)}
              <td class="font-semibold text-center bg-blue-50 text-blue-800" id="bf-sum-${dateStr}">${bp+bs+bn+bg2||''}</td>
              ${makeMealInput('l_p',dateStr,lp)} ${makeMealInput('l_s',dateStr,ls)} ${makeMealInput('l_n',dateStr,ln)} ${makeMealInput('l_g',dateStr,lg)}
              <td class="font-semibold text-center bg-green-50 text-green-800" id="l-sum-${dateStr}">${lp+ls+ln+lg||''}</td>
              ${makeMealInput('d_p',dateStr,dp)} ${makeMealInput('d_s',dateStr,ds)} ${makeMealInput('d_n',dateStr,dn)} ${makeMealInput('d_g',dateStr,dg)}
              <td class="font-semibold text-center bg-purple-50 text-purple-800" id="d-sum-${dateStr}">${dp+ds+dn+dg||''}</td>
              <td class="text-center bg-gray-50" id="t-p-${dateStr}">${bp+lp+dp||''}</td>
              <td class="text-center bg-gray-50" id="t-s-${dateStr}">${bs+ls+ds||''}</td>
              <td class="text-center bg-gray-50" id="t-n-${dateStr}">${bn+ln+dn||''}</td>
              <td class="text-center bg-gray-50" id="t-g-${dateStr}">${bg2+lg+dg||''}</td>
              <td class="font-bold text-center bg-blue-100 text-blue-900" id="t-total-${dateStr}">${(bp+bs+bn+bg2)+(lp+ls+ln+lg)+(dp+ds+dn+dg)||''}</td>
            </tr>`
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="bg-gray-100 font-bold" style="font-size:11px">
            <td colspan="2" class="text-center py-2">월 합계</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_patient||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_staff||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_noncovered||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_guardian||0),0))}</td>
            <td class="text-center bg-blue-100 font-bold">${fmt(mealData.reduce((s,m)=>s+(m.breakfast_patient||0)+(m.breakfast_staff||0)+(m.breakfast_noncovered||0)+(m.breakfast_guardian||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_patient||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_staff||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_noncovered||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.lunch_guardian||0),0))}</td>
            <td class="text-center bg-green-100 font-bold">${fmt(mealData.reduce((s,m)=>s+(m.lunch_patient||0)+(m.lunch_staff||0)+(m.lunch_noncovered||0)+(m.lunch_guardian||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_patient||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_staff||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_noncovered||0),0))}</td>
            <td class="text-center">${fmt(mealData.reduce((s,m)=>s+(m.dinner_guardian||0),0))}</td>
            <td class="text-center bg-purple-100 font-bold">${fmt(mealData.reduce((s,m)=>s+(m.dinner_patient||0)+(m.dinner_staff||0)+(m.dinner_noncovered||0)+(m.dinner_guardian||0),0))}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.p)}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.s)}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.n)}</td>
            <td class="text-center bg-gray-200 font-bold">${fmt(monthTotal.g)}</td>
            <td class="text-center bg-blue-200 font-bold text-blue-900">${fmt(monthTotal.p+monthTotal.s+monthTotal.n+monthTotal.g)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>`

  bindMealInputEvents()
}

function makeMealInput(key, date, val) {
  return `<td><input type="number" class="meal-input" data-key="${key}" data-date="${date}" value="${val||''}" placeholder="" min="0"></td>`
}

function bindMealInputEvents() {
  document.querySelectorAll('.meal-input').forEach(input => {
    input.addEventListener('input', function() { updateMealRowTotals(this.dataset.date) })
    input.addEventListener('change', async function() {
      const date = this.dataset.date
      const get = (k) => getMealVal(k, date)
      await api('POST', '/api/meals/save', {
        mealDate: date,
        breakfastPatient: get('bf_p'), breakfastStaff: get('bf_s'), breakfastNoncovered: get('bf_n'), breakfastGuardian: get('bf_g'),
        lunchPatient: get('l_p'), lunchStaff: get('l_s'), lunchNoncovered: get('l_n'), lunchGuardian: get('l_g'),
        dinnerPatient: get('d_p'), dinnerStaff: get('d_s'), dinnerNoncovered: get('d_n'), dinnerGuardian: get('d_g')
      })
    })
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        const inputs = [...document.querySelectorAll('.meal-input')]
        const idx = inputs.indexOf(this)
        if (idx < inputs.length-1) { e.preventDefault(); inputs[idx+1].focus() }
      }
    })
  })
}

function getMealVal(key, date) {
  return parseInt(document.querySelector(`input.meal-input[data-key="${key}"][data-date="${date}"]`)?.value||0)||0
}

function updateMealRowTotals(date) {
  const g = (k) => getMealVal(k, date)
  const bp=g('bf_p'),bs=g('bf_s'),bn=g('bf_n'),bg2=g('bf_g')
  const lp=g('l_p'),ls=g('l_s'),ln=g('l_n'),lg=g('l_g')
  const dp=g('d_p'),ds=g('d_s'),dn=g('d_n'),dg=g('d_g')
  const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v||'' }
  set(`bf-sum-${date}`,bp+bs+bn+bg2); set(`l-sum-${date}`,lp+ls+ln+lg); set(`d-sum-${date}`,dp+ds+dn+dg)
  set(`t-p-${date}`,bp+lp+dp); set(`t-s-${date}`,bs+ls+ds); set(`t-n-${date}`,bn+ln+dn); set(`t-g-${date}`,bg2+lg+dg)
  set(`t-total-${date}`,(bp+bs+bn+bg2)+(lp+ls+ln+lg)+(dp+ds+dn+dg))
}

async function saveMealBatch() {
  const rows = document.querySelectorAll('#mealTableBody tr[data-date]')
  let saved = 0
  const promises = []
  rows.forEach(row => {
    const date = row.dataset.date
    const g = (k) => getMealVal(k, date)
    const total = ['bf_p','bf_s','bf_n','bf_g','l_p','l_s','l_n','l_g','d_p','d_s','d_n','d_g'].reduce((s,k)=>s+g(k),0)
    if (total > 0) {
      saved++
      promises.push(api('POST', '/api/meals/save', {
        mealDate: date,
        breakfastPatient: g('bf_p'), breakfastStaff: g('bf_s'), breakfastNoncovered: g('bf_n'), breakfastGuardian: g('bf_g'),
        lunchPatient: g('l_p'), lunchStaff: g('l_s'), lunchNoncovered: g('l_n'), lunchGuardian: g('l_g'),
        dinnerPatient: g('d_p'), dinnerStaff: g('d_s'), dinnerNoncovered: g('d_n'), dinnerGuardian: g('d_g')
      }))
    }
  })
  await Promise.all(promises)
  showToast(`${saved}일치 식수 저장 완료!`, 'success')
}

// ══════════════════════════════════════════════════════════════
//  연간 분석 페이지
// ══════════════════════════════════════════════════════════════
async function renderAnalysis(selectedHospitalId = null) {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  // admin이면 병원 목록 먼저 로드
  let hospitals = []
  if (App.role === 'admin') {
    const hList = await api('GET', '/api/admin/hospitals')
    hospitals = hList || []
    if (!selectedHospitalId && hospitals.length > 0) selectedHospitalId = hospitals[0].id
  }

  const url = App.role === 'admin'
    ? `/api/dashboard/annual/${App.currentYear}?hospitalId=${selectedHospitalId}`
    : `/api/dashboard/annual/${App.currentYear}`

  const data = await api('GET', url)
  if (!data) {
    content.innerHTML = '<div class="text-red-500 p-6">데이터 로드 실패</div>'
    return
  }

  const months = Array.from({length:12}, (_,i) => `${i+1}월`)
  const usedByMonth = Array(12).fill(0)
  const budgetByMonth = Array(12).fill(0)
  const mealsByMonth = Array(12).fill(0)
  const mealPriceByMonth = Array(12).fill(0)

  ;(data.monthly||[]).forEach(m => { usedByMonth[parseInt(m.month)-1] = m.total_used })
  ;(data.settings||[]).forEach(m => { budgetByMonth[m.month-1] = m.total_budget })
  ;(data.mealMonthly||[]).forEach(m => {
    const idx = parseInt(m.month)-1
    mealsByMonth[idx] = m.total_meals
    if (m.total_meals > 0 && usedByMonth[idx] > 0) {
      mealPriceByMonth[idx] = Math.round(usedByMonth[idx] / m.total_meals)
    }
  })

  const totalUsed = usedByMonth.reduce((s,v)=>s+v,0)
  const totalBudget = budgetByMonth.reduce((s,v)=>s+v,0)
  const totalMeals = mealsByMonth.reduce((s,v)=>s+v,0)
  const avgMealPrice = totalMeals > 0 ? Math.round(totalUsed / totalMeals) : 0

  // admin 병원 선택 셀렉트
  const hospitalSelectHtml = App.role === 'admin' && hospitals.length > 0 ? `
  <div class="mb-4 flex items-center gap-3">
    <label class="text-sm font-semibold text-gray-600">병원 선택</label>
    <select id="analysisHospitalSelect" onchange="renderAnalysis(this.value)"
      class="form-input" style="width:auto;min-width:180px">
      ${hospitals.map(h => `<option value="${h.id}" ${h.id == selectedHospitalId ? 'selected' : ''}>${h.name}</option>`).join('')}
    </select>
    <span class="text-sm text-gray-400">${App.currentYear}년 연간 분석</span>
  </div>` : ''

  content.innerHTML = `
  ${hospitalSelectHtml}

  <!-- 연간 요약 -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">연간 총 사용</div>
      <div class="text-xl font-bold text-green-700">${fmtMan(totalUsed)}원</div>
      <div class="text-xs text-gray-400">예산: ${fmtMan(totalBudget)}원</div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">연간 진행률</div>
      <div class="text-xl font-bold ${totalBudget>0&&totalUsed>totalBudget?'text-red-600':'text-green-600'}">
        ${totalBudget > 0 ? ((totalUsed/totalBudget)*100).toFixed(1) : 0}%
      </div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">연간 총 식수</div>
      <div class="text-xl font-bold text-purple-600">${fmt(totalMeals)}식</div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">평균 식단가</div>
      <div class="text-xl font-bold text-orange-600">${fmt(avgMealPrice)}원</div>
    </div>
  </div>

  <!-- 월별 카드 -->
  <div class="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
    ${months.map((m, i) => {
      const used = usedByMonth[i]
      const budget = budgetByMonth[i]
      const pct = budget > 0 ? (used/budget*100) : null
      const isCurrentMonth = (i+1) === App.currentMonth
      return `<div class="stat-card ${isCurrentMonth?'ring-2 ring-green-500':''}">
        <div class="flex justify-between items-center mb-1">
          <span class="font-semibold text-sm ${isCurrentMonth?'text-green-700':''}">${m}</span>
          <span class="badge ${pct!==null?getBadgeColor(pct):'badge-gray'}" style="font-size:9px">${pct!==null?pct.toFixed(0)+'%':'-'}</span>
        </div>
        <div class="font-bold text-gray-800 text-sm">${used>0?fmtMan(used)+'원':'-'}</div>
        ${budget > 0 ? `<div class="mt-1 progress-bar h-1.5">
          <div class="progress-fill ${getProgressColor(pct||0)}" style="width:${Math.min(pct||0,100)}%"></div>
        </div>` : ''}
      </div>`
    }).join('')}
  </div>

  <!-- 차트들 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 mb-4">${App.currentYear}년 월별 예산 vs 사용금액</h2>
      <canvas id="annualChart"></canvas>
    </div>
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 class="font-bold text-gray-800 mb-4">월별 식수 추이 & 식단가</h2>
      <canvas id="mealChart"></canvas>
    </div>
  </div>`

  App.charts.annual = new Chart(document.getElementById('annualChart'), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: '사용금액', data: usedByMonth, backgroundColor: 'rgba(22,163,74,0.75)', borderRadius: 6 },
        { label: '목표예산', data: budgetByMonth, type: 'line', borderColor: '#ef4444', borderDash: [5,5], borderWidth: 2, pointRadius: 3, fill: false }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { ticks: { callback: v => `${(v/10000000).toFixed(0)}천만` } } }
    }
  })

  App.charts.meal = new Chart(document.getElementById('mealChart'), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: '식수', data: mealsByMonth, backgroundColor: 'rgba(16,185,129,0.6)', borderRadius: 4, yAxisID: 'y' },
        { label: '식단가', data: mealPriceByMonth, type: 'line', borderColor: '#f59e0b', borderWidth: 2, pointRadius: 4, fill: false, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: { ticks: { callback: v => `${v}식` }, position: 'left' },
        y1: { ticks: { callback: v => `${(v/1000).toFixed(1)}천원` }, position: 'right', grid: { drawOnChartArea: false } }
      }
    }
  })
}

// ══════════════════════════════════════════════════════════════
//  설정 페이지
// ══════════════════════════════════════════════════════════════
async function renderSettings() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  // 마감 현황 + 활성 월 정보 로드
  const [activeMonth, closingInfo] = await Promise.all([
    api('GET', '/api/settings/active-month'),
    api('GET', '/api/settings/closing-status')
  ])

  const activeYear = activeMonth?.year || App.currentYear
  const activeMon = activeMonth?.month || App.currentMonth
  const closingStatus = activeMonth?.closingStatus || 'open'
  const closingReqAt = activeMonth?.closingRequestedAt

  content.innerHTML = `
  <div class="max-w-2xl mx-auto space-y-5">

    <!-- 현재 활성 월 안내 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="font-bold text-gray-800 mb-4">
        <i class="fas fa-calendar-check text-green-600 mr-2"></i>현재 운영 월
      </h2>
      <div class="flex items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
          <i class="fas fa-calendar-alt text-green-600 text-2xl"></i>
        </div>
        <div>
          <div class="text-3xl font-bold text-green-700">${activeYear}년 ${activeMon}월</div>
          <div class="text-sm text-gray-500 mt-1">현재 발주 입력 및 관리 중인 월</div>
        </div>
        <div class="ml-auto">
          <span class="badge ${closingStatus==='requested'?'badge-yellow':closingStatus==='closed'?'badge-green':'badge-gray'} text-sm px-3 py-1">
            ${closingStatus==='requested'?'마감 요청중':closingStatus==='closed'?'마감완료':'운영중'}
          </span>
        </div>
      </div>
      ${closingReqAt ? `<div class="mt-3 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
        <i class="fas fa-clock mr-1"></i>마감 요청일: ${closingReqAt?.split('T')[0]} · 관리자 승인 대기 중
      </div>` : ''}
    </div>

    <!-- 마감 요청 카드 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="font-bold text-gray-800 mb-2">
        <i class="fas fa-flag-checkered text-green-600 mr-2"></i>월 마감 요청
      </h2>
      <p class="text-sm text-gray-500 mb-5">
        이번 달 발주 입력이 완료되면 관리자에게 마감 요청을 보내세요.<br>
        관리자가 승인하면 다음 달로 자동 전환됩니다.
      </p>

      ${closingStatus === 'requested' ? `
      <!-- 이미 요청됨 -->
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
        <i class="fas fa-hourglass-half text-amber-500 text-xl"></i>
        <div>
          <div class="font-semibold text-amber-800">${activeYear}년 ${activeMon}월 마감 요청 완료</div>
          <div class="text-sm text-amber-600">관리자의 승인을 기다리고 있습니다</div>
        </div>
      </div>
      ` : closingStatus === 'closed' ? `
      <!-- 마감 완료 -->
      <div class="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
        <i class="fas fa-check-circle text-green-500 text-xl"></i>
        <div>
          <div class="font-semibold text-green-800">마감 완료</div>
          <div class="text-sm text-green-600">다음 달로 전환되었습니다</div>
        </div>
      </div>
      ` : `
      <!-- 마감 요청 폼 -->
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-600 mb-1">마감 메모 (선택)</label>
          <textarea id="closingMemo" class="form-input" rows="3" placeholder="특이사항, 인수인계 내용 등을 입력하세요"></textarea>
        </div>
        <button onclick="submitClosingRequest(${activeYear},${activeMon})" class="btn btn-primary w-full">
          <i class="fas fa-paper-plane mr-2"></i>${activeYear}년 ${activeMon}월 마감 요청 보내기
        </button>
      </div>
      `}
    </div>

    <!-- 안내 사항 -->
    <div class="bg-gray-50 rounded-2xl border border-gray-100 p-5">
      <h3 class="font-semibold text-gray-600 mb-3 text-sm"><i class="fas fa-info-circle text-gray-400 mr-1"></i>안내</h3>
      <ul class="text-sm text-gray-500 space-y-2">
        <li><i class="fas fa-check text-green-500 mr-2 text-xs"></i>예산 목표 설정과 업체 관리는 <strong class="text-gray-700">관리자</strong>가 직접 설정합니다</li>
        <li><i class="fas fa-check text-green-500 mr-2 text-xs"></i>발주 입력은 <strong class="text-gray-700">발주 입력</strong> 메뉴에서 진행하세요</li>
        <li><i class="fas fa-check text-green-500 mr-2 text-xs"></i>관리자가 마감을 <strong class="text-gray-700">승인하면 다음 달로 전환</strong>됩니다</li>
        <li><i class="fas fa-check text-green-500 mr-2 text-xs"></i>문의사항은 관리자에게 연락하세요</li>
      </ul>
    </div>

  </div>`
}

async function submitClosingRequest(year, month) {
  const memo = document.getElementById('closingMemo')?.value || ''
  if (!confirm(`${year}년 ${month}월 마감 요청을 보내시겠습니까?\n관리자 승인 후 다음 달로 전환됩니다.`)) return
  const res = await api('POST', '/api/settings/closing-request', { year, month, memo })
  if (res?.success) {
    showToast('마감 요청이 전송되었습니다. 관리자 승인을 기다려 주세요.', 'success')
    renderSettings()
  } else {
    showToast('마감 요청 실패', 'error')
  }
}

async function saveSettings() {
  const get = id => parseInt(document.getElementById(id)?.value||0)||0
  const res = await api('POST', '/api/settings/save', {
    year: App.currentYear, month: App.currentMonth,
    totalBudget: get('set-totalBudget'), eventBudget: get('set-eventBudget'),
    mealPrice: get('set-mealPrice'), foodWasteBudget: get('set-foodWasteBudget'),
    workingDays: get('set-workingDays')
  })
  if (res?.success) showToast('설정이 저장되었습니다', 'success')
  else showToast('저장 실패', 'error')
}

function showAddVendorModal() {
  document.getElementById('vendorModalTitle').textContent = '업체 추가'
  document.getElementById('vendorId').value = ''
  document.getElementById('vendorName').value = ''
  document.getElementById('vendorBudget').value = ''
  document.getElementById('vendorModal').classList.remove('hidden')
}

function editVendor(id) {
  const btn = document.querySelector(`[onclick="editVendor(${id})"]`)
  const name = btn?.dataset.name || ''
  const category = btn?.dataset.cat || 'general'
  const taxType = btn?.dataset.tax || 'mixed'
  const budget = parseInt(btn?.dataset.budget || 0)
  document.getElementById('vendorModalTitle').textContent = '업체 수정'
  document.getElementById('vendorId').value = id
  document.getElementById('vendorName').value = name
  document.getElementById('vendorCategory').value = category
  document.getElementById('vendorTaxType').value = taxType
  document.getElementById('vendorBudget').value = budget
  document.getElementById('vendorModal').classList.remove('hidden')
}

function closeVendorModal() { document.getElementById('vendorModal').classList.add('hidden') }

async function saveVendor() {
  const id = document.getElementById('vendorId').value
  const data = {
    name: document.getElementById('vendorName').value,
    category: document.getElementById('vendorCategory').value,
    taxType: document.getElementById('vendorTaxType').value,
    monthlyBudget: parseInt(document.getElementById('vendorBudget').value||0)||0
  }
  if (!data.name.trim()) { showToast('업체명을 입력하세요', 'error'); return }
  const res = id ? await api('PUT', `/api/vendors/${id}`, data) : await api('POST', '/api/vendors', data)
  if (res?.success) {
    closeVendorModal()
    showToast(id ? '업체가 수정되었습니다' : '업체가 추가되었습니다', 'success')
    renderSettings()
  }
}

async function deleteVendor(id) {
  if (!confirm('업체를 삭제하시겠습니까?\n(해당 업체의 발주 데이터는 유지됩니다)')) return
  await api('DELETE', `/api/vendors/${id}`)
  showToast('업체가 삭제되었습니다', 'success')
  renderSettings()
}

// ══════════════════════════════════════════════════════════════
//  관리자 대시보드
// ══════════════════════════════════════════════════════════════
async function renderAdminDashboard() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const data = await api('GET', `/api/dashboard/admin/overview/${App.currentYear}/${App.currentMonth}`)
  if (!data) return

  const totalUsed = data.hospitals.reduce((s,h)=>s+h.totalUsed, 0)
  const totalBudget = data.hospitals.reduce((s,h)=>s+h.totalBudget, 0)
  const avgProgress = data.hospitals.filter(h=>h.totalBudget>0).length > 0
    ? data.hospitals.filter(h=>h.totalBudget>0).reduce((s,h)=>s+parseFloat(h.progress),0) / data.hospitals.filter(h=>h.totalBudget>0).length
    : 0

  content.innerHTML = `
  <!-- 전체 요약 -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">관리 병원</div>
      <div class="text-3xl font-bold text-green-700">${data.hospitals.length}<span class="text-sm font-normal text-gray-400 ml-1">개</span></div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">이달 총 사용</div>
      <div class="text-xl font-bold text-gray-800">${fmtMan(totalUsed)}<span class="text-xs text-gray-400 ml-1">원</span></div>
      <div class="text-xs text-gray-400">예산: ${fmtMan(totalBudget)}원</div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">평균 진행률</div>
      <div class="text-xl font-bold ${avgProgress>=100?'text-red-600':avgProgress>=80?'text-yellow-600':'text-green-600'}">${avgProgress.toFixed(1)}%</div>
    </div>
    <div class="stat-card">
      <div class="text-xs text-gray-500 mb-1">예산 초과 병원</div>
      <div class="text-xl font-bold ${data.hospitals.filter(h=>h.totalUsed>h.totalBudget&&h.totalBudget>0).length>0?'text-red-600':'text-gray-800'}">
        ${data.hospitals.filter(h=>h.totalUsed>h.totalBudget&&h.totalBudget>0).length}개
      </div>
    </div>
  </div>

  <!-- 탭 -->
  <div class="flex gap-2 mb-4 border-b border-gray-200">
    <button id="adminTab-overview" onclick="switchAdminTab('overview')" class="px-4 py-2 text-sm font-medium border-b-2 border-green-600 text-green-700">
      <i class="fas fa-th-large mr-1"></i>병원 현황
    </button>
    <button id="adminTab-orders" onclick="switchAdminTab('orders')" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700">
      <i class="fas fa-chart-bar mr-1"></i>발주 현황 (전 병원)
    </button>
  </div>

  <!-- 병원 현황 탭 -->
  <div id="adminContent-overview">
    <!-- 병원별 카드 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${data.hospitals.map(h => {
        const pct = parseFloat(h.progress)
        const over = h.totalBudget > 0 && h.totalUsed > h.totalBudget
        return `
        <div class="bg-white rounded-2xl shadow-sm border ${over?'border-red-200':'border-gray-100'} p-5 hover:shadow-md transition-shadow">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl ${over?'bg-red-50':'bg-green-50'} flex items-center justify-center">
                <i class="fas fa-hospital ${over?'text-red-500':'text-green-600'}"></i>
              </div>
              <div>
                <div class="font-bold text-gray-800">${h.hospital.name}</div>
                <div class="text-xs text-gray-400">${h.hospital.code} · 오늘 ${fmtMan(h.todayUsed)}원</div>
              </div>
            </div>
            <div class="text-right">
              <span class="badge ${getBadgeColor(pct)}">${h.progress}%</span>
              ${over?'<div class="text-xs text-red-500 mt-1 font-semibold">예산 초과</div>':''}
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3 text-sm mb-3">
            <div class="text-center p-2 bg-gray-50 rounded-lg">
              <div class="text-xs text-gray-400">사용</div>
              <div class="font-semibold text-green-700">${fmtMan(h.totalUsed)}원</div>
            </div>
            <div class="text-center p-2 bg-gray-50 rounded-lg">
              <div class="text-xs text-gray-400">목표</div>
              <div class="font-semibold">${h.totalBudget>0?fmtMan(h.totalBudget)+'원':'-'}</div>
            </div>
            <div class="text-center p-2 ${h.remaining<0?'bg-red-50':'bg-green-50'} rounded-lg">
              <div class="text-xs ${h.remaining<0?'text-red-400':'text-gray-400'}">잔여</div>
              <div class="font-semibold ${h.remaining<0?'text-red-600':'text-green-600'}">${fmtMan(h.remaining)}원</div>
            </div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${getProgressColor(pct)}" style="width:${Math.min(pct,100)}%"></div>
          </div>
          ${h.totalMeals>0?`<div class="mt-2 text-xs text-gray-400 text-right">총 식수: ${fmt(h.totalMeals)}식 · 식단가: ${fmt(h.mealPrice)}원</div>`:''}
        </div>`
      }).join('')}
    </div>
  </div>

  <!-- 발주 현황 탭 -->
  <div id="adminContent-orders" class="hidden">
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-gray-700"><i class="fas fa-chart-bar text-green-600 mr-2"></i>${App.currentYear}년 ${App.currentMonth}월 전 병원 발주 현황</h3>
        <button onclick="loadAdminOrdersView()" class="btn btn-secondary btn-sm"><i class="fas fa-sync mr-1"></i>새로고침</button>
      </div>
      <div id="adminOrdersContent">
        <div class="flex items-center justify-center h-32"><div class="loading-spinner"></div></div>
      </div>
    </div>
  </div>`

  // 발주 현황 초기 로드
  loadAdminOrdersView()
}

window.switchAdminTab = (tab) => {
  ;['overview','orders'].forEach(t => {
    document.getElementById(`adminContent-${t}`)?.classList.toggle('hidden', t !== tab)
    const btn = document.getElementById(`adminTab-${t}`)
    if (btn) {
      if (t === tab) {
        btn.className = 'px-4 py-2 text-sm font-medium border-b-2 border-green-600 text-green-700'
      } else {
        btn.className = 'px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700'
      }
    }
  })
  if (tab === 'orders') loadAdminOrdersView()
}

async function loadAdminOrdersView() {
  const container = document.getElementById('adminOrdersContent')
  if (!container) return
  container.innerHTML = '<div class="flex items-center justify-center h-32"><div class="loading-spinner"></div></div>'

  const data = await api('GET', `/api/dashboard/admin/overview/${App.currentYear}/${App.currentMonth}`)
  if (!data) { container.innerHTML = '<div class="text-red-500 p-4">데이터 로드 실패</div>'; return }

  const hospitals = data.hospitals || []

  // 전체 요약 표
  const tableRows = hospitals.map(h => {
    const pct = parseFloat(h.progress)
    const todayPct = h.dailyBudget > 0 ? Math.round(h.todayUsed / h.dailyBudget * 100) : 0
    const weekPct = h.weekBudget > 0 ? Math.round(h.weekUsed / h.weekBudget * 100) : 0
    const over = h.totalBudget > 0 && h.totalUsed > h.totalBudget
    return `
    <tr class="${over?'bg-red-50':''}">
      <td class="font-semibold text-sm">${h.hospital.name}</td>
      <td class="text-center">
        <div class="text-xs font-bold ${todayPct>=100?'text-red-600':todayPct>=80?'text-yellow-600':'text-green-700'}">${todayPct}%</div>
        <div class="text-xs text-gray-400">${fmtMan(h.todayUsed)}원</div>
      </td>
      <td class="text-center">
        <div class="text-xs font-bold ${weekPct>=100?'text-red-600':weekPct>=80?'text-yellow-600':'text-green-700'}">${weekPct}%</div>
        <div class="text-xs text-gray-400">${fmtMan(h.weekUsed||0)}원</div>
      </td>
      <td class="text-center">
        <div class="text-xs font-bold ${pct>=100?'text-red-600':pct>=80?'text-yellow-600':'text-green-700'}">${pct.toFixed(1)}%</div>
        <div class="progress-bar h-1.5 mt-1 mb-1"><div class="progress-fill ${getProgressColor(pct)}" style="width:${Math.min(pct,100)}%"></div></div>
        <div class="text-xs text-gray-400">${fmtMan(h.totalUsed)} / ${h.totalBudget>0?fmtMan(h.totalBudget):'-'}원</div>
      </td>
      <td class="text-center">
        <span class="text-xs ${h.remaining<0?'text-red-600 font-semibold':'text-green-700'}">${fmtMan(h.remaining)}원</span>
      </td>
    </tr>`
  }).join('')

  container.innerHTML = `
  <div class="overflow-x-auto rounded-xl border border-gray-100">
    <table class="data-table w-full">
      <thead>
        <tr>
          <th class="text-left pl-4">병원명</th>
          <th class="text-center">일별 달성률</th>
          <th class="text-center">주별 달성률</th>
          <th class="text-center">월별 달성률</th>
          <th class="text-center">잔여예산</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
  <div class="mt-4 grid grid-cols-1 gap-3">
    ${hospitals.map(h => {
      const pct = parseFloat(h.progress)
      return `
      <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
        <div class="w-24 text-xs font-semibold text-gray-700 truncate">${h.hospital.name}</div>
        <div class="flex-1">
          <div class="progress-bar h-3">
            <div class="progress-fill ${getProgressColor(pct)}" style="width:${Math.min(pct,100)}%"></div>
          </div>
        </div>
        <div class="text-xs font-bold w-12 text-right ${pct>=100?'text-red-600':pct>=80?'text-yellow-600':'text-green-700'}">${pct.toFixed(1)}%</div>
        <div class="text-xs text-gray-400 w-20 text-right">${fmtMan(h.totalUsed)}원</div>
      </div>`
    }).join('')}
  </div>`
}

// ══════════════════════════════════════════════════════════════
//  스케줄 관리 페이지
// ══════════════════════════════════════════════════════════════
async function renderSchedule() {
  const content = document.getElementById('pageContent')
  const days = getDaysInMonth(App.currentYear, App.currentMonth)
  
  // 스케줄 데이터 로드 시도
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`
  
  // 직원 목록과 스케줄 로드
  const [empData, schedData] = await Promise.all([
    api('GET', '/api/schedule/employees').catch(() => null),
    api('GET', `/api/schedule/${App.currentYear}/${App.currentMonth}`).catch(() => null)
  ])

  const employees = empData || []
  const schedMap = {}
  ;(schedData || []).forEach(s => {
    if (!schedMap[s.employee_id]) schedMap[s.employee_id] = {}
    schedMap[s.employee_id][s.work_date] = s.shift_code
  })

  const SHIFTS = ['a', 'b', 'c', 'za', 'zb', 'F', '연', '휴', '반', '-']
  const SHIFT_COLORS = {
    'a': 'bg-blue-100 text-blue-700', 'b': 'bg-green-100 text-green-700',
    'c': 'bg-pink-100 text-pink-700', 'za': 'bg-indigo-100 text-indigo-700',
    'zb': 'bg-emerald-100 text-emerald-700', 'F': 'bg-red-100 text-red-700',
    '연': 'bg-yellow-100 text-yellow-700', '휴': 'bg-orange-100 text-orange-700',
    '반': 'bg-purple-100 text-purple-700', '-': 'bg-gray-50 text-gray-300'
  }

  content.innerHTML = `
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="font-bold text-gray-800">${App.currentYear}년 ${App.currentMonth}월 근무 스케줄</h2>
        <p class="text-xs text-gray-400 mt-0.5">셀 클릭으로 근무코드 변경 · 자동 저장</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="showAddEmployeeModal()" class="btn btn-success btn-sm">
          <i class="fas fa-user-plus"></i> 직원 추가
        </button>
      </div>
    </div>
    
    <!-- 근무코드 범례 -->
    <div class="px-5 py-2 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-2">
      ${SHIFTS.filter(s=>s!=='-').map(s => `
        <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${SHIFT_COLORS[s]||'bg-gray-100 text-gray-600'}">${s}</span>
      `).join('')}
      <span class="text-xs text-gray-400 ml-2 self-center">클릭으로 변경</span>
    </div>

    <div class="overflow-x-auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#166534;color:white">
            <th style="padding:8px 12px;text-align:left;min-width:80px;position:sticky;left:0;background:#166534;z-index:10">이름/직책</th>
            ${Array.from({length:days},(_,i)=>{
              const day=i+1, dow=getDayOfWeek(App.currentYear,App.currentMonth,day)
              const isWknd=isWeekend(App.currentYear,App.currentMonth,day)
              return `<th style="padding:6px 4px;text-align:center;min-width:34px;font-weight:${isWknd?'bold':'normal'};color:${dow==='토'?'#93c5fd':dow==='일'?'#fca5a5':'white'}">
                <div>${day}</div><div style="font-size:9px">${dow}</div>
              </th>`
            }).join('')}
            <th style="padding:8px 6px;min-width:50px">근무</th>
            <th style="padding:8px 6px;min-width:40px">연차</th>
          </tr>
        </thead>
        <tbody>
          ${employees.length === 0 ? `
            <tr><td colspan="${days+3}" class="text-center py-12 text-gray-400">
              <i class="fas fa-users text-4xl mb-3 block"></i>
              등록된 직원이 없습니다. 직원을 추가해주세요.
            </td></tr>
          ` : employees.map(emp => {
            const empSchedule = schedMap[emp.id] || {}
            let workDays = 0, annualDays = 0, restDays = 0
            for (let d=1; d<=days; d++) {
              const dateStr = `${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`
              const shift = empSchedule[dateStr]
              if (shift && shift !== '-' && shift !== '휴' && shift !== '연') workDays++
              if (shift === '연') annualDays++
              if (shift === '휴') restDays++
            }
            return `<tr style="border-bottom:1px solid #f1f5f9" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
              <td style="padding:6px 12px;position:sticky;left:0;background:white;z-index:5">
                <div class="font-semibold text-gray-800">${emp.name}</div>
                <div style="font-size:10px;color:#94a3b8">${emp.position}</div>
              </td>
              ${Array.from({length:days},(_,i)=>{
                const day=i+1
                const dateStr=`${App.currentYear}-${String(App.currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const shift=empSchedule[dateStr]||''
                const isWknd=isWeekend(App.currentYear,App.currentMonth,day)
                const cellBg=isWknd?'background:#fffbeb;':'background:white;'
                const colorClass=SHIFT_COLORS[shift]||''
                return `<td style="padding:4px;text-align:center;${cellBg}cursor:pointer" 
                  onclick="cycleShift(${emp.id},'${dateStr}',this)"
                  data-shift="${shift}" data-employee="${emp.id}" data-date="${dateStr}">
                  <span class="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${colorClass||'bg-gray-50 text-gray-300'}">${shift||'·'}</span>
                </td>`
              }).join('')}
              <td style="padding:6px;text-align:center;background:#f0fdf4" class="font-semibold text-green-700">${workDays}</td>
              <td style="padding:6px;text-align:center;background:#fef9c3" class="font-semibold text-yellow-700">${annualDays}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- 직원 추가 모달 -->
  <div id="empModal" class="hidden modal-overlay">
    <div class="modal-box max-w-md p-6">
      <h3 class="font-bold text-lg mb-4">직원 추가</h3>
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-gray-600">이름 *</label>
            <input type="text" id="empName" class="form-input mt-1" placeholder="홍길동">
          </div>
          <div>
            <label class="text-sm font-medium text-gray-600">직책 *</label>
            <input type="text" id="empPosition" class="form-input mt-1" placeholder="조리장">
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-600">소속</label>
          <select id="empSection" class="form-input mt-1">
            <option value="cook">조리팀</option>
            <option value="manager">매니저</option>
            <option value="hall">홀/전포</option>
            <option value="part">파트타임</option>
          </select>
        </div>
      </div>
      <div class="flex gap-2 mt-5">
        <button onclick="addEmployee()" class="btn btn-primary flex-1">추가</button>
        <button onclick="document.getElementById('empModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>
      </div>
    </div>
  </div>`

  // 근무 코드 순환 클릭 핸들러
  window.cycleShift = async (empId, date, cell) => {
    const currentShift = cell.dataset.shift || ''
    const idx = SHIFTS.indexOf(currentShift)
    const nextShift = SHIFTS[(idx + 1) % SHIFTS.length]
    
    cell.dataset.shift = nextShift
    const span = cell.querySelector('span')
    if (span) {
      span.className = `inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${SHIFT_COLORS[nextShift]||'bg-gray-50 text-gray-300'}`
      span.textContent = nextShift === '-' ? '·' : nextShift
    }

    // 저장
    if (nextShift === '-') {
      await api('DELETE', `/api/schedule/${empId}/${date}`).catch(() => null)
    } else {
      await api('POST', '/api/schedule/save', { employeeId: empId, workDate: date, shiftCode: nextShift }).catch(() => null)
    }
  }
}

window.showAddEmployeeModal = () => {
  document.getElementById('empModal').classList.remove('hidden')
}

window.addEmployee = async () => {
  const name = document.getElementById('empName').value.trim()
  const position = document.getElementById('empPosition').value.trim()
  const section = document.getElementById('empSection').value
  if (!name || !position) { showToast('이름과 직책을 입력하세요', 'error'); return }
  const res = await api('POST', '/api/schedule/employees', { name, position, section })
  if (res?.success) {
    document.getElementById('empModal').classList.add('hidden')
    showToast('직원이 추가되었습니다', 'success')
    renderSchedule()
  }
}

// ══════════════════════════════════════════════════════════════
//  병원 관리 페이지 (관리자)
// ══════════════════════════════════════════════════════════════
async function renderHospitalManage() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const [hospitals, closingReqs] = await Promise.all([
    api('GET', '/api/admin/hospitals'),
    api('GET', '/api/admin/closing-requests')
  ])

  const pendingClosings = closingReqs || []

  // 알림 읽음 처리
  if (pendingClosings.length > 0) {
    await api('POST', '/api/admin/notifications/read-all')
    loadNotificationBadge()
  }

  content.innerHTML = `
  <!-- 마감 요청 알림 -->
  ${pendingClosings.length > 0 ? `
  <div class="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
    <div class="flex items-center gap-2 mb-3">
      <i class="fas fa-bell text-amber-500 animate-pulse"></i>
      <span class="font-bold text-amber-800">마감 요청 대기 중 (${pendingClosings.length}건)</span>
    </div>
    <div class="space-y-2">
      ${pendingClosings.map(r => `
        <div class="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-100">
          <div>
            <span class="font-semibold text-gray-800">${r.hospital_name}</span>
            <span class="text-sm text-gray-500 ml-2">${r.year}년 ${r.month}월 마감 요청</span>
            <span class="text-xs text-gray-400 ml-2">${r.requested_at?.split('T')[0]}</span>
          </div>
          <button onclick="approveClosing(${r.hospital_id},${r.year},${r.month})"
            class="btn btn-primary btn-sm">
            <i class="fas fa-check mr-1"></i>승인 & 다음달 전환
          </button>
        </div>
      `).join('')}
    </div>
  </div>` : ''}

  <!-- 병원 목록 -->
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="p-5 border-b border-gray-100 flex items-center justify-between">
      <h2 class="font-bold text-gray-800"><i class="fas fa-hospital text-green-600 mr-2"></i>병원 목록</h2>
      <span class="text-sm text-gray-400">총 ${(hospitals||[]).length}개 병원</span>
    </div>
    <div class="divide-y divide-gray-50">
      ${(hospitals||[]).map(h => `
        <div class="p-4 hover:bg-gray-50 transition cursor-pointer" onclick="openHospitalDetail(${h.id})">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <i class="fas fa-hospital text-green-600 text-sm"></i>
              </div>
              <div>
                <div class="font-semibold text-gray-800">${h.name}</div>
                <div class="text-xs text-gray-400">
                  ${getHospitalTypeLabel(h.hospital_type)} · 
                  ${h.licensed_beds||'-'}병상 · 
                  ${h.dietitian_name||'영양사 미등록'}
                  ${h.main_specialty ? ` · <span class="text-green-600 font-medium">${h.main_specialty}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="badge ${h.closing_status==='requested'?'badge-yellow':h.closing_status==='closed'?'badge-green':'badge-gray'}">
                ${h.closing_status==='requested'?'마감 요청중':h.closing_status==='closed'?'마감완료':'운영중'}
              </span>
              <span class="text-sm text-green-700 font-semibold">${h.current_year||2026}년 ${h.current_month||3}월</span>
              <i class="fas fa-chevron-right text-gray-300 text-xs"></i>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </div>`
}

function getHospitalTypeLabel(type) {
  const map = {
    general:'종합병원', oriental:'한방병원', nursing:'요양병원',
    rehab:'재활병원', clinic:'의원', care_facility:'요양원'
  }
  return map[type] || '병원'
}

async function approveClosing(hospitalId, year, month) {
  if (!confirm(`${year}년 ${month}월 마감을 승인하고 다음달로 전환할까요?`)) return
  const res = await api('POST', `/api/admin/closing-approve/${hospitalId}`, { year, month })
  if (res?.success) {
    showToast(`마감 승인 완료! ${res.nextYear}년 ${res.nextMonth}월로 전환되었습니다`, 'success')
    renderHospitalManage()
  }
}

async function openHospitalDetail(hospitalId) {
  const [hosp, budget, vendorList, accounts] = await Promise.all([
    api('GET', `/api/admin/hospitals/${hospitalId}`),
    api('GET', `/api/admin/hospitals/${hospitalId}/budget/${App.currentYear}/${App.currentMonth}`),
    api('GET', `/api/admin/hospitals/${hospitalId}/vendors`),
    api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
  ])
  if (!hosp) return

  const s = budget?.settings || {}
  const vendors = vendorList || []

  // 현재 관리 중인 hospitalId를 전역에 저장
  window._adminHospitalId = hospitalId
  window._adminHospVendors = vendors  // 예산탭 갱신에 사용

  const modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'hospDetailModal'
  modal.innerHTML = `
  <div class="modal-box" style="max-width:820px">
    <div class="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
      <h2 class="font-bold text-xl text-gray-800"><i class="fas fa-hospital text-green-600 mr-2"></i>${hosp.name}</h2>
      <button onclick="document.getElementById('hospDetailModal').remove()" class="text-gray-400 hover:text-gray-600 text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100">✕</button>
    </div>
    <div class="p-6 space-y-6">

      <!-- 탭 -->
      <div class="flex gap-2 border-b border-gray-100 pb-3">
        <button class="tab-btn active" id="tab-info" onclick="switchHospTab('info')">
          <i class="fas fa-info-circle mr-1"></i>기본정보
        </button>
        <button class="tab-btn" id="tab-budget" onclick="switchHospTab('budget')">
          <i class="fas fa-won-sign mr-1"></i>예산설정
        </button>
        <button class="tab-btn" id="tab-vendors" onclick="switchHospTab('vendors')">
          <i class="fas fa-store mr-1"></i>업체관리
        </button>
        <button class="tab-btn" id="tab-accounts" onclick="switchHospTab('accounts')">
          <i class="fas fa-user-circle mr-1"></i>계정관리
        </button>
      </div>

      <!-- 기본정보 탭 -->
      <div id="hospTab-info">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">병원명</label>
            <input id="hi-name" class="form-input" value="${hosp.name||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">병원 유형</label>
            <select id="hi-type" class="form-input">
              ${[['general','종합병원'],['oriental','한방병원'],['nursing','요양병원'],['rehab','재활병원'],['clinic','의원'],['care_facility','요양원']]
                .map(([v,l]) => `<option value="${v}" ${hosp.hospital_type===v?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">주소</label>
            <input id="hi-address" class="form-input" value="${hosp.address||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">허가 병상수</label>
            <input id="hi-beds" type="number" class="form-input" value="${hosp.licensed_beds||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">평균 입원환자수</label>
            <input id="hi-inpatients" type="number" class="form-input" value="${hosp.avg_inpatients||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">급식 대상 직원수</label>
            <input id="hi-staff" type="number" class="form-input" value="${hosp.staff_count||0}">
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">주 종목 <span class="text-gray-400 font-normal">(암, 교통사고, 척추, 관절 등 직접 입력)</span></label>
            <input id="hi-specialty" class="form-input" placeholder="예: 암, 교통사고, 척추 재활" value="${hosp.main_specialty||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">급식 운영방식</label>
            <select id="hi-optype" class="form-input">
              <option value="direct" ${hosp.operation_type==='direct'?'selected':''}>직영</option>
              <option value="consignment" ${hosp.operation_type==='consignment'?'selected':''}>위탁</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">위탁업체명</label>
            <input id="hi-consign" class="form-input" value="${hosp.consignment_company||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">1일 급식횟수</label>
            <select id="hi-meals" class="form-input">
              <option value="2" ${hosp.meals_per_day==2?'selected':''}>2식</option>
              <option value="3" ${hosp.meals_per_day==3?'selected':''}>3식</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">납품 방식</label>
            <select id="hi-supply" class="form-input">
              <option value="direct" ${hosp.supply_method==='direct'?'selected':''}>직납</option>
              <option value="market" ${hosp.supply_method==='market'?'selected':''}>시장</option>
              <option value="mixed" ${hosp.supply_method==='mixed'?'selected':''}>혼합</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">현재 식단가 (원/식)</label>
            <input id="hi-curprice" type="number" class="form-input" value="${hosp.current_meal_price||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">목표 식단가 (원/식)</label>
            <input id="hi-tgtprice" type="number" class="form-input" value="${hosp.target_meal_price||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">연간 총 급식예산 (원)</label>
            <input id="hi-annual" type="number" class="form-input" value="${hosp.annual_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">영양사 이름</label>
            <input id="hi-dietname" class="form-input" value="${hosp.dietitian_name||''}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">영양사 연락처</label>
            <input id="hi-dietphone" class="form-input" value="${hosp.dietitian_phone||''}">
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold text-gray-500 mb-1">관리자 메모</label>
            <textarea id="hi-memo" class="form-input" rows="3">${hosp.admin_memo||''}</textarea>
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <button onclick="saveHospitalInfo(${hospitalId})" class="btn btn-primary">
            <i class="fas fa-save mr-1"></i>기본정보 저장
          </button>
        </div>
      </div>

      <!-- 예산설정 탭 -->
      <div id="hospTab-budget" class="hidden">
        <div class="text-sm font-semibold text-gray-600 mb-3">${App.currentYear}년 ${App.currentMonth}월 예산 설정</div>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">월 총 목표금액 (원)</label>
            <input id="hb-total" type="number" class="form-input" value="${s.total_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">이벤트 예산 (원)</label>
            <input id="hb-event" type="number" class="form-input" value="${s.event_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">소모품 목표금액 (원)</label>
            <input id="hb-supply" type="number" class="form-input" value="${s.supply_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">법인카드 목표금액 (원)</label>
            <input id="hb-card" type="number" class="form-input" value="${s.card_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">목표 식단가 (원/식)</label>
            <input id="hb-mealprice" type="number" class="form-input" value="${s.meal_price||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">잔반 목표금액 (원)</label>
            <input id="hb-waste" type="number" class="form-input" value="${s.food_waste_budget||0}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 mb-1">해당월 영업일수 (일)</label>
            <input id="hb-workdays" type="number" class="form-input" value="${s.working_days || getDefaultWorkingDays(App.currentYear, App.currentMonth)}">
            <p class="text-xs text-gray-400 mt-1">* 자동계산: ${getDefaultWorkingDays(App.currentYear, App.currentMonth)}일 (해당월 전체일수)</p>
          </div>
        </div>

        <!-- 업체별 목표금액 -->
        <div class="border-t border-gray-100 pt-4">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-store text-green-600 mr-1"></i>업체별 월 목표금액</h3>
          <div id="hospBudgetVendors">
            ${renderBudgetVendorRows(vendors)}
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <button onclick="saveHospitalBudget(${hospitalId})" class="btn btn-primary">
            <i class="fas fa-save mr-1"></i>예산설정 저장
          </button>
        </div>
      </div>

      <!-- 업체관리 탭 -->
      <div id="hospTab-vendors" class="hidden">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-store text-green-600 mr-1"></i>등록 업체 목록</h3>
          <button onclick="showAdminAddVendorModal()" class="btn btn-success btn-sm">
            <i class="fas fa-plus mr-1"></i>업체 추가
          </button>
        </div>
        <div id="adminVendorList">
          ${renderAdminVendorRows(vendors)}
        </div>
      </div>

      <!-- 계정관리 탭 -->
      <div id="hospTab-accounts" class="hidden">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-user-circle text-green-600 mr-1"></i>병원 계정 목록</h3>
          <button onclick="showAdminAddAccountModal()" class="btn btn-success btn-sm">
            <i class="fas fa-plus mr-1"></i>계정 추가
          </button>
        </div>
        <div id="adminAccountList">
          ${renderAdminAccountRows(accounts || [])}
        </div>
        <div class="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-600">
          <i class="fas fa-info-circle mr-1"></i>
          병원 계정은 발주 입력, 식수 관리, 마감 요청 등에 사용됩니다. 관리자 계정은 이 화면에서 관리하지 않습니다.
        </div>
      </div>

    </div>
  </div>

  <!-- 업체 추가/수정 모달 (관리자용) -->
  <div id="adminVendorModal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4">
      <h3 class="font-bold text-lg mb-4" id="adminVendorModalTitle">업체 추가</h3>
      <input type="hidden" id="adminVendorId">
      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium text-gray-600">업체명 *</label>
          <input type="text" id="adminVendorName" class="form-input mt-1" placeholder="예: 삼성 웰스토리">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-gray-600">카테고리</label>
            <select id="adminVendorCategory" class="form-input mt-1">
              <option value="major">대기업급식</option>
              <option value="meat">육류</option>
              <option value="seafood">해산물</option>
              <option value="fruit">청과</option>
              <option value="organic">유기농/한살림</option>
              <option value="market">시장/유통</option>
              <option value="delivery">인터넷배송</option>
              <option value="card">법인카드</option>
              <option value="event">이벤트</option>
              <option value="general">기타</option>
            </select>
          </div>
          <div>
            <label class="text-sm font-medium text-gray-600">세금 구분</label>
            <select id="adminVendorTaxType" class="form-input mt-1">
              <option value="mixed">과세+면세</option>
              <option value="taxable">과세만</option>
              <option value="exempt">면세만</option>
            </select>
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-600">월 목표금액 (원)</label>
          <input type="number" id="adminVendorBudget" class="form-input mt-1" placeholder="0 (없으면 0)">
        </div>
      </div>
      <div class="flex gap-2 mt-5">
        <button onclick="saveAdminVendor()" class="btn btn-primary flex-1">저장</button>
        <button onclick="document.getElementById('adminVendorModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>
      </div>
    </div>
  </div>

  <!-- 계정 추가/수정 모달 (관리자용) -->
  <div id="adminAccountModal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4">
      <h3 class="font-bold text-lg mb-4" id="adminAccountModalTitle">계정 추가</h3>
      <input type="hidden" id="adminAccountId">
      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium text-gray-600">아이디 *</label>
          <input type="text" id="adminAccountUsername" class="form-input mt-1" placeholder="영문+숫자 조합 권장">
        </div>
        <div>
          <label class="text-sm font-medium text-gray-600" id="adminAccountPwLabel">비밀번호 *</label>
          <input type="password" id="adminAccountPassword" class="form-input mt-1" placeholder="비밀번호 입력">
          <p class="text-xs text-gray-400 mt-1" id="adminAccountPwHint"></p>
        </div>
      </div>
      <div class="flex gap-2 mt-5">
        <button onclick="saveAdminAccount()" class="btn btn-primary flex-1">저장</button>
        <button onclick="document.getElementById('adminAccountModal').classList.add('hidden')" class="btn btn-secondary flex-1">취소</button>
      </div>
    </div>
  </div>`

  document.body.appendChild(modal)
}

// 예산설정 탭 업체별 목표금액 행 렌더
function renderBudgetVendorRows(vendors) {
  if (!vendors || vendors.length === 0) {
    return `<div class="text-center py-8 text-gray-400">
      <i class="fas fa-store text-3xl mb-2 block text-gray-300"></i>
      <p class="text-sm">등록된 업체가 없습니다</p>
      <p class="text-xs mt-1">업체관리 탭에서 업체를 먼저 추가하세요</p>
    </div>`
  }
  return `<div class="space-y-2">
    ${vendors.map(v => `
      <div class="flex items-center gap-3 py-2 border-b border-gray-50">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${getCategoryColor(v.category)}"></span>
        <div class="flex-1 min-w-0">
          <span class="font-medium text-sm">${v.name}</span>
          <span class="text-xs text-gray-400 ml-2">${getCategoryLabel(v.category)}</span>
        </div>
        <div class="flex items-center gap-2">
          <input id="hvb-${v.id}" type="number" class="form-input w-40 text-right text-sm py-1.5"
            value="${v.monthly_budget||0}" placeholder="0">
          <span class="text-xs text-gray-400 whitespace-nowrap">원</span>
        </div>
      </div>
    `).join('')}
  </div>`
}

// 계정 목록 행 렌더
function renderAdminAccountRows(accounts) {
  if (!accounts || accounts.length === 0) {
    return `<div class="text-center py-10 text-gray-400">
      <i class="fas fa-user-circle text-4xl mb-3 block text-gray-300"></i>
      <p class="text-sm">등록된 계정이 없습니다</p>
      <p class="text-xs mt-1">계정 추가 버튼을 눌러 계정을 등록하세요</p>
    </div>`
  }
  return `<div class="divide-y divide-gray-50">
    ${accounts.map(a => `
      <div class="flex items-center gap-3 py-3 hover:bg-gray-50 px-2 rounded-lg">
        <div class="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-user text-green-600 text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">${a.username}</div>
          <div class="text-xs text-gray-400">생성일: ${a.created_at?.split('T')[0] || '-'}</div>
        </div>
        <div class="flex gap-1">
          <button onclick="editAdminAccount(${a.id}, '${a.username}')"
            class="btn btn-secondary btn-sm px-2" title="비밀번호 변경">
            <i class="fas fa-key text-xs"></i>
          </button>
          <button onclick="deleteAdminAccount(${a.id}, '${a.username}')"
            class="btn btn-danger btn-sm px-2" title="계정 삭제">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>
      </div>
    `).join('')}
  </div>`
}

function renderAdminVendorRows(vendors) {
  if (!vendors || vendors.length === 0) {
    return `<div class="text-center py-10 text-gray-400">
      <i class="fas fa-store text-4xl mb-3 block text-gray-300"></i>
      <p class="text-sm">등록된 업체가 없습니다</p>
      <p class="text-xs mt-1 text-gray-300">업체 추가 버튼을 눌러 업체를 등록하세요</p>
    </div>`
  }
  return `<div class="divide-y divide-gray-50">
    ${vendors.map((v, idx) => `
      <div class="flex items-center gap-3 py-3 hover:bg-gray-50 px-2 rounded-lg" id="avendor-row-${v.id}">
        <span class="text-gray-400 text-xs w-5 text-center">${idx+1}</span>
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${getCategoryColor(v.category)}"></span>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">${v.name}</div>
          <div class="text-xs text-gray-400">${getCategoryLabel(v.category)} · ${getTaxTypeLabel(v.tax_type)}</div>
        </div>
        <div class="text-sm text-gray-600 font-medium">${v.monthly_budget>0?fmtMan(v.monthly_budget)+'원':'목표없음'}</div>
        <div class="flex gap-1">
          <button onclick="editAdminVendor(${v.id})"
            data-name="${v.name.replace(/"/g,'&quot;')}" data-cat="${v.category}" data-tax="${v.tax_type}" data-budget="${v.monthly_budget}"
            class="btn btn-secondary btn-sm px-2"><i class="fas fa-edit text-xs"></i></button>
          <button onclick="deleteAdminVendor(${v.id})"
            class="btn btn-danger btn-sm px-2"><i class="fas fa-trash text-xs"></i></button>
        </div>
      </div>
    `).join('')}
  </div>`
}

function showAdminAddVendorModal() {
  document.getElementById('adminVendorModalTitle').textContent = '업체 추가'
  document.getElementById('adminVendorId').value = ''
  document.getElementById('adminVendorName').value = ''
  document.getElementById('adminVendorCategory').value = 'general'
  document.getElementById('adminVendorTaxType').value = 'mixed'
  document.getElementById('adminVendorBudget').value = ''
  document.getElementById('adminVendorModal').classList.remove('hidden')
}

function editAdminVendor(id) {
  // 클릭된 버튼의 data 속성에서 값 읽기
  const btn = document.querySelector(`[onclick="editAdminVendor(${id})"]`)
  const name = btn?.dataset.name || ''
  const category = btn?.dataset.cat || 'general'
  const taxType = btn?.dataset.tax || 'mixed'
  const budget = parseInt(btn?.dataset.budget || 0)
  document.getElementById('adminVendorModalTitle').textContent = '업체 수정'
  document.getElementById('adminVendorId').value = id
  document.getElementById('adminVendorName').value = name
  document.getElementById('adminVendorCategory').value = category
  document.getElementById('adminVendorTaxType').value = taxType
  document.getElementById('adminVendorBudget').value = budget
  document.getElementById('adminVendorModal').classList.remove('hidden')
}

async function saveAdminVendor() {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const vid = document.getElementById('adminVendorId').value
  const data = {
    name: document.getElementById('adminVendorName').value.trim(),
    category: document.getElementById('adminVendorCategory').value,
    taxType: document.getElementById('adminVendorTaxType').value,
    monthlyBudget: parseInt(document.getElementById('adminVendorBudget').value||0)||0
  }
  if (!data.name) { showToast('업체명을 입력하세요', 'error'); return }
  const res = vid
    ? await api('PUT', `/api/admin/hospitals/${hospitalId}/vendors/${vid}`, data)
    : await api('POST', `/api/admin/hospitals/${hospitalId}/vendors`, data)
  if (res?.success) {
    document.getElementById('adminVendorModal').classList.add('hidden')
    showToast(vid ? '업체가 수정되었습니다' : '업체가 추가되었습니다', 'success')
    // 업체 목록 + 예산탭 동시 갱신
    const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/vendors`)
    window._adminHospVendors = updated || []
    document.getElementById('adminVendorList').innerHTML = renderAdminVendorRows(updated || [])
    document.getElementById('hospBudgetVendors').innerHTML = renderBudgetVendorRows(updated || [])
  } else {
    showToast('저장 실패', 'error')
  }
}

async function deleteAdminVendor(vid) {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  if (!confirm('업체를 삭제하시겠습니까?\n(해당 업체의 발주 데이터는 유지됩니다)')) return
  await api('DELETE', `/api/admin/hospitals/${hospitalId}/vendors/${vid}`)
  showToast('업체가 삭제되었습니다', 'success')
  // 업체 목록 + 예산탭 동시 갱신
  const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/vendors`)
  window._adminHospVendors = updated || []
  document.getElementById('adminVendorList').innerHTML = renderAdminVendorRows(updated || [])
  document.getElementById('hospBudgetVendors').innerHTML = renderBudgetVendorRows(updated || [])
}

// ── 계정 관리 함수 ────────────────────────────────────────────
function showAdminAddAccountModal() {
  document.getElementById('adminAccountModalTitle').textContent = '계정 추가'
  document.getElementById('adminAccountId').value = ''
  document.getElementById('adminAccountUsername').value = ''
  document.getElementById('adminAccountUsername').disabled = false
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPwLabel').textContent = '비밀번호 *'
  document.getElementById('adminAccountPwHint').textContent = ''
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

function editAdminAccount(id, username) {
  document.getElementById('adminAccountModalTitle').textContent = '비밀번호 변경'
  document.getElementById('adminAccountId').value = id
  document.getElementById('adminAccountUsername').value = username
  document.getElementById('adminAccountUsername').disabled = true
  document.getElementById('adminAccountPassword').value = ''
  document.getElementById('adminAccountPwLabel').textContent = '새 비밀번호 *'
  document.getElementById('adminAccountPwHint').textContent = '새 비밀번호를 입력하면 변경됩니다'
  document.getElementById('adminAccountModal').classList.remove('hidden')
}

async function saveAdminAccount() {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  const aid = document.getElementById('adminAccountId').value
  const username = document.getElementById('adminAccountUsername').value.trim()
  const password = document.getElementById('adminAccountPassword').value

  if (!username) { showToast('아이디를 입력하세요', 'error'); return }
  if (!password) { showToast('비밀번호를 입력하세요', 'error'); return }
  if (password.length < 4) { showToast('비밀번호는 4자 이상 입력하세요', 'error'); return }

  const res = aid
    ? await api('PUT', `/api/admin/hospitals/${hospitalId}/accounts/${aid}`, { password })
    : await api('POST', `/api/admin/hospitals/${hospitalId}/accounts`, { username, password })

  if (res?.success) {
    document.getElementById('adminAccountModal').classList.add('hidden')
    showToast(aid ? '비밀번호가 변경되었습니다' : '계정이 생성되었습니다', 'success')
    const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
    document.getElementById('adminAccountList').innerHTML = renderAdminAccountRows(updated || [])
  } else if (res?.error) {
    showToast(res.error, 'error')
  } else {
    showToast('저장 실패', 'error')
  }
}

async function deleteAdminAccount(aid, username) {
  const hospitalId = window._adminHospitalId
  if (!hospitalId) return
  if (!confirm(`"${username}" 계정을 삭제하시겠습니까?`)) return
  const res = await api('DELETE', `/api/admin/hospitals/${hospitalId}/accounts/${aid}`)
  if (res?.success) {
    showToast('계정이 삭제되었습니다', 'success')
    const updated = await api('GET', `/api/admin/hospitals/${hospitalId}/accounts`)
    document.getElementById('adminAccountList').innerHTML = renderAdminAccountRows(updated || [])
  } else {
    showToast('삭제 실패', 'error')
  }
}

function getDefaultWorkingDays(year, month) {
  return new Date(year, month, 0).getDate()
}

function switchHospTab(tab) {
  ['info','budget','vendors','accounts'].forEach(t => {
    document.getElementById(`hospTab-${t}`)?.classList.toggle('hidden', t !== tab)
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab)
  })
}

async function saveHospitalInfo(hospitalId) {
  const body = {
    name: document.getElementById('hi-name').value,
    address: document.getElementById('hi-address').value,
    hospital_type: document.getElementById('hi-type').value,
    licensed_beds: parseInt(document.getElementById('hi-beds').value)||0,
    avg_inpatients: parseInt(document.getElementById('hi-inpatients').value)||0,
    staff_count: parseInt(document.getElementById('hi-staff').value)||0,
    main_specialty: document.getElementById('hi-specialty').value,
    operation_type: document.getElementById('hi-optype').value,
    consignment_company: document.getElementById('hi-consign').value,
    meals_per_day: parseInt(document.getElementById('hi-meals').value)||3,
    current_meal_price: parseInt(document.getElementById('hi-curprice').value)||0,
    target_meal_price: parseInt(document.getElementById('hi-tgtprice').value)||0,
    supply_method: document.getElementById('hi-supply').value,
    annual_budget: parseInt(document.getElementById('hi-annual').value)||0,
    dietitian_name: document.getElementById('hi-dietname').value,
    dietitian_phone: document.getElementById('hi-dietphone').value,
    admin_memo: document.getElementById('hi-memo').value
  }
  const res = await api('PUT', `/api/admin/hospitals/${hospitalId}/info`, body)
  if (res?.success) showToast('기본정보가 저장되었습니다', 'success')
  else showToast('저장 실패', 'error')
}

async function saveHospitalBudget(hospitalId) {
  // 업체별 목표금액 수집 (hvb-{vendorId} 형식의 입력 필드)
  const vendorBudgets = []
  document.querySelectorAll('[id^="hvb-"]').forEach(el => {
    const vid = el.id.replace('hvb-', '')
    vendorBudgets.push({ vendorId: parseInt(vid), budget: parseInt(el.value||0)||0 })
  })

  const body = {
    totalBudget: parseInt(document.getElementById('hb-total').value)||0,
    eventBudget: parseInt(document.getElementById('hb-event').value)||0,
    mealPrice: parseInt(document.getElementById('hb-mealprice').value)||0,
    foodWasteBudget: parseInt(document.getElementById('hb-waste').value)||0,
    workingDays: parseInt(document.getElementById('hb-workdays').value)||0,
    supplyBudget: parseInt(document.getElementById('hb-supply').value)||0,
    cardBudget: parseInt(document.getElementById('hb-card').value)||0,
    vendorBudgets
  }
  const res = await api('POST', `/api/admin/hospitals/${hospitalId}/budget/${App.currentYear}/${App.currentMonth}`, body)
  if (res?.success) showToast('예산설정이 저장되었습니다', 'success')
  else showToast('저장 실패', 'error')
}

// ══════════════════════════════════════════════════════════════
//  공휴일 관리 페이지 (관리자)
// ══════════════════════════════════════════════════════════════
async function renderHolidayManage() {
  const content = document.getElementById('pageContent')
  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  const holidays = await api('GET', `/api/admin/holidays/${App.currentYear}`)

  content.innerHTML = `
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-gray-800"><i class="fas fa-calendar-times text-green-600 mr-2"></i>${App.currentYear}년 공휴일 관리</h2>
      <button onclick="showAddHolidayForm()" class="btn btn-primary btn-sm">
        <i class="fas fa-plus mr-1"></i>공휴일 추가
      </button>
    </div>
    <div id="addHolidayForm" class="hidden mb-4 p-4 bg-green-50 rounded-xl border border-green-200">
      <div class="flex gap-3 items-end">
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">날짜</label>
          <input id="newHolidayDate" type="date" class="form-input" style="width:160px">
        </div>
        <div class="flex-1">
          <label class="block text-xs font-semibold text-gray-600 mb-1">공휴일명</label>
          <input id="newHolidayName" class="form-input" placeholder="예) 창립기념일">
        </div>
        <button onclick="addHoliday()" class="btn btn-success btn-sm">추가</button>
        <button onclick="document.getElementById('addHolidayForm').classList.add('hidden')" class="btn btn-secondary btn-sm">취소</button>
      </div>
    </div>
    <div class="overflow-hidden rounded-xl border border-gray-100">
      <table class="data-table">
        <thead><tr><th>날짜</th><th>공휴일명</th><th>구분</th><th>관리</th></tr></thead>
        <tbody>
          ${(holidays||[]).map(h => `
            <tr>
              <td class="font-mono text-sm">${h.holiday_date}</td>
              <td class="font-semibold">${h.name}</td>
              <td><span class="badge ${h.is_auto?'badge-blue':'badge-purple'}">${h.is_auto?'자동':'수동'}</span></td>
              <td>
                <button onclick="deleteHoliday('${h.holiday_date}')" class="btn btn-danger btn-sm">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          `).join('')}
          ${(holidays||[]).length===0?'<tr><td colspan="4" class="text-center text-gray-400 py-8">등록된 공휴일이 없습니다</td></tr>':''}
        </tbody>
      </table>
    </div>
  </div>`
}

function showAddHolidayForm() {
  document.getElementById('addHolidayForm').classList.remove('hidden')
  const today = new Date().toISOString().split('T')[0]
  document.getElementById('newHolidayDate').value = today
}

async function addHoliday() {
  const date = document.getElementById('newHolidayDate').value
  const name = document.getElementById('newHolidayName').value.trim()
  if (!date || !name) { showToast('날짜와 공휴일명을 입력하세요', 'error'); return }
  const res = await api('POST', '/api/admin/holidays', { date, name })
  if (res?.success) { showToast('공휴일이 추가되었습니다', 'success'); renderHolidayManage() }
}

async function deleteHoliday(date) {
  if (!confirm(`${date} 공휴일을 삭제할까요?`)) return
  const res = await api('DELETE', `/api/admin/holidays/${date}`)
  if (res?.success) { showToast('삭제되었습니다', 'success'); renderHolidayManage() }
}

// ══════════════════════════════════════════════════════════════
//  보고서 출력 페이지 (관리자 전용)
// ══════════════════════════════════════════════════════════════
async function renderReport(selectedHospitalId = null) {
  const content = document.getElementById('pageContent')

  // 관리자만 접근 가능
  if (App.role !== 'admin') {
    content.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
      <i class="fas fa-lock text-4xl text-gray-300 mb-4"></i>
      <h3 class="text-lg font-semibold text-gray-500 mb-2">접근 제한</h3>
      <p class="text-sm text-gray-400">보고서 출력은 관리자만 사용할 수 있습니다</p>
    </div>`
    return
  }

  content.innerHTML = `<div class="flex items-center justify-center h-40"><div class="loading-spinner"></div></div>`

  let hospitals = []
  let hospitalName = App.hospitalName
  let targetHospitalId = null

  if (App.role === 'admin') {
    hospitals = await api('GET', '/api/admin/hospitals') || []
    if (!selectedHospitalId && hospitals.length > 0) selectedHospitalId = hospitals[0].id
    targetHospitalId = selectedHospitalId
    const h = hospitals.find(x => x.id == selectedHospitalId)
    hospitalName = h?.name || ''
  }

  const reportYear = App.currentYear
  const reportMonth = App.currentMonth
  const nextMonth = reportMonth === 12 ? 1 : reportMonth + 1
  const nextYear = reportMonth === 12 ? reportYear + 1 : reportYear

  const [summaryData, annualData, nextSettingsData] = await Promise.all([
    api('GET', `/api/dashboard/summary/${reportYear}/${reportMonth}?hospitalId=${targetHospitalId}`),
    api('GET', `/api/dashboard/annual/${reportYear}?hospitalId=${targetHospitalId}`),
    api('GET', `/api/settings/${nextYear}/${nextMonth}?hospitalId=${targetHospitalId}`)
  ])

  const s = summaryData?.summary || {}
  const vendors = summaryData?.vendors || []
  const ms = summaryData?.mealStats || {}
  const dailyOrders = summaryData?.dailyOrders || []
  const vendorOrders = summaryData?.vendorOrders || vendors

  const monthlyUsed = (annualData?.monthly||[])
  const monthlyMeals = (annualData?.mealMonthly||[])
  const monthlySettings = (annualData?.settings||[])

  const nextSettings = nextSettingsData?.settings || {}
  const nextBudget = nextSettings.total_budget || 0
  const nextMealPrice = nextSettings.meal_price || 0

  // 일별 발주 데이터 정리
  const daysCount = new Date(reportYear, reportMonth, 0).getDate()
  const dailyMap = {}
  dailyOrders.forEach(d => {
    const day = parseInt(d.order_date.split('-')[2])
    dailyMap[day] = (dailyMap[day]||0) + d.daily_total
  })
  const dailyLabels = Array.from({length:daysCount}, (_,i)=>`${i+1}`)
  const dailyValues = Array.from({length:daysCount}, (_,i)=>dailyMap[i+1]||0)

  content.innerHTML = `
  <!-- 보고서 컨트롤 (인쇄 제외) -->
  <div class="mb-4 flex items-center gap-3 flex-wrap no-print">
    <select id="reportHospitalSelect" onchange="renderReport(this.value)" class="form-input" style="width:auto;min-width:180px">
      ${hospitals.map(h => `<option value="${h.id}" ${h.id==selectedHospitalId?'selected':''}>${h.name}</option>`).join('')}
    </select>
    <div class="flex items-center gap-2 text-sm text-gray-500">
      <i class="fas fa-file-pdf text-red-500"></i>
      <span>${reportYear}년 ${reportMonth}월 월간 보고서</span>
    </div>
    <div class="ml-auto flex gap-2">
      <button onclick="window.print()" class="btn btn-secondary btn-sm">
        <i class="fas fa-print mr-1"></i>인쇄/PDF저장
      </button>
      <button onclick="exportReportPPT('${hospitalName}',${reportYear},${reportMonth})" class="btn btn-primary btn-sm">
        <i class="fas fa-file-powerpoint mr-1"></i>PPT 다운로드
      </button>
    </div>
  </div>

  <!-- ══ 보고서 본문 (인쇄 대상) ══ -->
  <div id="reportBody" class="space-y-6">

    <!-- 슬라이드 1: 표지 -->
    <div class="report-slide bg-gradient-to-br from-green-800 to-green-600 text-white rounded-2xl p-10 text-center shadow-lg">
      <div class="text-5xl mb-4">🏥</div>
      <h1 class="text-3xl font-bold mb-2">${hospitalName}</h1>
      <h2 class="text-xl mb-6 opacity-80">급식 운영 월간 보고서</h2>
      <div class="text-4xl font-bold mb-2">${reportYear}년 ${reportMonth}월</div>
      <div class="text-sm opacity-60 mt-6">작성일: ${new Date().toLocaleDateString('ko-KR')}</div>
    </div>

    <!-- 슬라이드 2: 월 예산 요약 + 다음달 목표 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-chart-pie text-green-600 mr-2"></i>월 예산 요약</h2>
      <div class="grid grid-cols-4 gap-4 mb-6">
        ${[
          { label:'총 예산', val:`${fmtMan(s.totalBudget||0)}원`, color:'text-green-700' },
          { label:'사용금액', val:`${fmtMan(s.totalUsed||0)}원`, color:'text-green-700' },
          { label:'달성률', val:`${s.progress||0}%`, color: parseFloat(s.progress||0)>=100?'text-red-600':'text-green-700' },
          { label:'잔여예산', val:`${fmtMan(Math.abs(s.remaining||0))}원`, color:(s.remaining||0)<0?'text-red-600':'text-gray-800' }
        ].map(item => `
          <div class="bg-gray-50 rounded-xl p-4 text-center">
            <div class="text-xs text-gray-500 mb-1">${item.label}</div>
            <div class="text-xl font-bold ${item.color}">${item.val}</div>
          </div>`).join('')}
      </div>
      <div class="mb-2 flex justify-between text-xs text-gray-500">
        <span>예산 달성률</span><span>${s.progress||0}%</span>
      </div>
      <div class="progress-bar h-4 mb-6">
        <div class="progress-fill ${getProgressColor(parseFloat(s.progress||0))}" style="width:${Math.min(parseFloat(s.progress||0),100)}%"></div>
      </div>
      <!-- 다음달 목표 -->
      ${nextBudget > 0 || nextMealPrice > 0 ? `
      <div class="border-t border-gray-100 pt-4">
        <h3 class="text-sm font-semibold text-gray-600 mb-3"><i class="fas fa-arrow-right text-green-600 mr-1"></i>${nextYear}년 ${nextMonth}월 목표</h3>
        <div class="grid grid-cols-2 gap-4">
          ${nextBudget > 0 ? `<div class="bg-green-50 rounded-xl p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">다음달 목표금액</div>
            <div class="text-lg font-bold text-green-700">${fmtWon(nextBudget)}</div>
          </div>` : ''}
          ${nextMealPrice > 0 ? `<div class="bg-green-50 rounded-xl p-3 text-center">
            <div class="text-xs text-gray-500 mb-1">다음달 목표 식단가</div>
            <div class="text-lg font-bold text-green-700">${fmtWon(nextMealPrice)}/식</div>
          </div>` : ''}
        </div>
      </div>` : ''}
    </div>

    <!-- 슬라이드 3: 업체별 발주 내역 표 + 차트 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-store text-green-600 mr-2"></i>업체별 발주 내역</h2>
      <div class="grid grid-cols-2 gap-6">
        <div>
          <div class="overflow-hidden rounded-xl border border-gray-100 mb-4">
            <table class="data-table w-full text-xs">
              <thead><tr><th class="text-left pl-3">업체명</th><th class="text-right">발주금액</th><th class="text-right">목표</th><th class="text-right">달성률</th></tr></thead>
              <tbody>
                ${vendors.map(v => {
                  const pct = v.monthly_budget > 0 ? Math.round(v.total_used / v.monthly_budget * 100) : null
                  const over = v.monthly_budget > 0 && v.total_used > v.monthly_budget
                  return `<tr class="${over?'bg-red-50':''}">
                    <td class="pl-3 font-medium">${v.name}</td>
                    <td class="text-right pr-3 font-semibold ${over?'text-red-600':'text-green-700'}">${fmtMan(v.total_used)}원</td>
                    <td class="text-right pr-3 text-gray-400">${v.monthly_budget>0?fmtMan(v.monthly_budget)+'원':'-'}</td>
                    <td class="text-right pr-3 ${over?'text-red-500 font-bold':''}">${pct!=null?pct+'%':'-'}</td>
                  </tr>`
                }).join('')}
                <tr class="bg-green-50 font-bold">
                  <td class="pl-3">합계</td>
                  <td class="text-right pr-3 text-green-700">${fmtMan(s.totalUsed||0)}원</td>
                  <td class="text-right pr-3 text-gray-400">${fmtMan(s.totalBudget||0)}원</td>
                  <td class="text-right pr-3">${s.progress||0}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div><canvas id="rpt-vendorChart" style="max-height:220px"></canvas></div>
      </div>
    </div>

    <!-- 슬라이드 4: 일별 매입금액 표 + 차트 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-calendar-day text-green-600 mr-2"></i>일별 매입금액 (1일~말일)</h2>
      <div class="grid grid-cols-2 gap-6">
        <div style="max-height:300px;overflow-y:auto">
          <table class="data-table w-full text-xs">
            <thead><tr><th>일</th><th>요일</th><th class="text-right">금액</th></tr></thead>
            <tbody>
              ${Array.from({length:daysCount},(_,i)=>{
                const day=i+1, val=dailyMap[day]||0
                const dow=['일','월','화','수','목','금','토'][new Date(reportYear,reportMonth-1,day).getDay()]
                const isWknd=dow==='토'||dow==='일'
                return `<tr class="${isWknd?'bg-gray-50':''}">
                  <td class="text-center">${day}</td>
                  <td class="text-center" style="color:${dow==='토'?'#16a34a':dow==='일'?'#ef4444':'#6b7280'}">${dow}</td>
                  <td class="text-right pr-3 ${val>0?'font-medium':''}">${val>0?fmtMan(val)+'원':'-'}</td>
                </tr>`
              }).join('')}
              <tr class="bg-green-50 font-bold"><td colspan="2" class="text-center">합계</td><td class="text-right pr-3 text-green-700">${fmtMan(dailyValues.reduce((s,v)=>s+v,0))}원</td></tr>
            </tbody>
          </table>
        </div>
        <div><canvas id="rpt-dailyChart" style="max-height:280px"></canvas></div>
      </div>
    </div>

    <!-- 슬라이드 5: 식수 현황 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-utensils text-green-600 mr-2"></i>식수 현황 통계</h2>
      <div class="grid grid-cols-4 gap-4 mb-6">
        ${[
          { label:'환자식', val:fmt((ms.total_patient||0)), icon:'fa-procedures', color:'bg-blue-50 text-blue-700' },
          { label:'직원식', val:fmt((ms.total_staff||0)), icon:'fa-user-md', color:'bg-green-50 text-green-700' },
          { label:'비급여식', val:fmt((ms.total_noncovered||0)), icon:'fa-user', color:'bg-purple-50 text-purple-700' },
          { label:'전체', val:fmt((ms.total_patient||0)+(ms.total_staff||0)+(ms.total_noncovered||0)), icon:'fa-users', color:'bg-gray-50 text-gray-700' }
        ].map(item => `
          <div class="rounded-xl p-4 text-center ${item.color.split(' ')[0]}">
            <i class="fas ${item.icon} text-2xl ${item.color.split(' ')[1]} mb-2"></i>
            <div class="text-xs text-gray-500 mb-1">${item.label}</div>
            <div class="text-xl font-bold ${item.color.split(' ')[1]}">${item.val}식</div>
          </div>`).join('')}
      </div>
      <canvas id="rpt-mealMonthChart" style="max-height:220px"></canvas>
    </div>

    <!-- 슬라이드 6: 식단가 분석 -->
    <div class="report-slide bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 class="report-slide-title"><i class="fas fa-coins text-green-600 mr-2"></i>식단가 월별 비교 분석</h2>
      <canvas id="rpt-mealPriceChart" style="max-height:250px"></canvas>
      <div class="mt-4 grid grid-cols-3 gap-4">
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <div class="text-xs text-gray-500 mb-1">이번달 식단가</div>
          <div class="text-lg font-bold text-green-700">${fmtWon(s.mealPrice||0)}</div>
        </div>
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <div class="text-xs text-gray-500 mb-1">목표 식단가</div>
          <div class="text-lg font-bold text-gray-700">${fmtWon(s.targetMealPrice||0)}</div>
        </div>
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <div class="text-xs text-gray-500 mb-1">전월 대비 차액</div>
          <div class="text-lg font-bold ${(s.mealPriceDiff||0)>0?'text-red-600':(s.mealPriceDiff||0)<0?'text-green-600':'text-gray-700'}">${(s.mealPriceDiff||0)>0?'+':''}${fmtWon(s.mealPriceDiff||0)}</div>
        </div>
      </div>
    </div>

  </div>`

  // ── 차트 렌더링 ──
  // 업체별 도넛차트
  const vendorLabels = vendors.map(v=>v.name)
  const vendorData = vendors.map(v=>v.total_used)
  if (document.getElementById('rpt-vendorChart') && vendorData.some(v=>v>0)) {
    App.charts.rptVendor = new Chart(document.getElementById('rpt-vendorChart'), {
      type: 'doughnut',
      data: {
        labels: vendorLabels,
        datasets: [{ data: vendorData,
          backgroundColor: ['#16a34a','#15803d','#22c55e','#86efac','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#64748b'] }]
      },
      options: { responsive:true, plugins:{ legend:{ position:'right', labels:{ font:{size:11} } } } }
    })
  }

  // 일별 바차트
  App.charts.rptDaily = new Chart(document.getElementById('rpt-dailyChart'), {
    type: 'bar',
    data: {
      labels: dailyLabels,
      datasets: [{ label:'일별 매입금액', data:dailyValues, backgroundColor:'rgba(22,163,74,0.7)', borderRadius:4 }]
    },
    options: { responsive:true,
      plugins:{ legend:{display:false} },
      scales:{ y:{ ticks:{ callback:v=>`${(v/10000).toFixed(0)}만` } } }
    }
  })

  // 월별 식수 차트
  const mMonths = Array.from({length:12}, (_,i)=>`${i+1}월`)
  const mMealsData = Array(12).fill(0)
  const mPriceData = Array(12).fill(0)
  const mUsedData = Array(12).fill(0)
  const mBudgetData = Array(12).fill(0)
  monthlyMeals.forEach(m=>{ mMealsData[parseInt(m.month)-1] = m.total_meals })
  monthlyUsed.forEach(m=>{ mUsedData[parseInt(m.month)-1] = m.total_used })
  monthlySettings.forEach(m=>{ mBudgetData[m.month-1] = m.total_budget })
  mMealsData.forEach((meals, i)=>{ if(meals>0&&mUsedData[i]>0) mPriceData[i] = Math.round(mUsedData[i]/meals) })

  App.charts.rptMealMonth = new Chart(document.getElementById('rpt-mealMonthChart'), {
    type: 'bar',
    data: {
      labels: mMonths,
      datasets: [
        { label:'전체 식수', data:mMealsData, backgroundColor:'rgba(22,163,74,0.6)', borderRadius:4, yAxisID:'y' }
      ]
    },
    options: { responsive:true,
      plugins:{ legend:{ labels:{ font:{size:11} } } },
      scales:{ y:{ ticks:{ callback:v=>`${v}식` }, position:'left' } }
    }
  })

  App.charts.rptMealPrice = new Chart(document.getElementById('rpt-mealPriceChart'), {
    type: 'line',
    data: {
      labels: mMonths,
      datasets: [
        { label:'식단가', data:mPriceData, borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,0.1)', fill:true, tension:0.4, pointRadius:5 },
        { label:'예산 기준가', data:mBudgetData.map((b,i)=>mMealsData[i]>0?Math.round(b/mMealsData[i]):0),
          borderColor:'#ef4444', borderDash:[5,5], borderWidth:2, pointRadius:3, fill:false }
      ]
    },
    options: { responsive:true,
      plugins:{ legend:{ labels:{ font:{size:11} } } },
      scales:{ y:{ ticks:{ callback:v=>`${v.toLocaleString()}원` } } }
    }
  })
}

async function exportReportPPT(hospitalName, year, month) {
  showToast('PPT 생성 중... 잠시 기다려주세요', 'warning')
  // pptxgenjs CDN 동적 로드
  if (!window.PptxGenJS) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
      s.onload = resolve; s.onerror = reject
      document.head.appendChild(s)
    })
  }
  const pptx = new window.PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'

  // 슬라이드 1: 표지
  const s1 = pptx.addSlide()
  s1.background = { color: '166534' }
  s1.addText(`${hospitalName}`, { x:1, y:1.5, w:11, h:1, fontSize:36, bold:true, color:'FFFFFF', align:'center' })
  s1.addText('급식 운영 월간 보고서', { x:1, y:2.7, w:11, h:0.7, fontSize:22, color:'CCFFCC', align:'center' })
  s1.addText(`${year}년 ${month}월`, { x:1, y:3.6, w:11, h:0.8, fontSize:28, bold:true, color:'FFFFFF', align:'center' })
  s1.addText(`작성일: ${new Date().toLocaleDateString('ko-KR')}`, { x:1, y:5.2, w:11, h:0.4, fontSize:13, color:'AAFFAA', align:'center' })

  // 슬라이드 2: 예산 요약
  const s2 = pptx.addSlide()
  s2.addText('월 예산 요약', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas1 = document.getElementById('rpt-vendorChart')
  if (canvas1) {
    s2.addImage({ data: canvas1.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  // 슬라이드 3: 일별 매입금액
  const s3 = pptx.addSlide()
  s3.addText('일별 매입금액', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas2 = document.getElementById('rpt-dailyChart')
  if (canvas2) {
    s3.addImage({ data: canvas2.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  // 슬라이드 4: 식수 현황
  const s4 = pptx.addSlide()
  s4.addText('식수 현황 월별 추이', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas3 = document.getElementById('rpt-mealMonthChart')
  if (canvas3) {
    s4.addImage({ data: canvas3.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  // 슬라이드 5: 식단가 분석
  const s5 = pptx.addSlide()
  s5.addText('식단가 월별 비교', { x:0.5, y:0.3, w:12, h:0.6, fontSize:24, bold:true, color:'166534' })
  const canvas4 = document.getElementById('rpt-mealPriceChart')
  if (canvas4) {
    s5.addImage({ data: canvas4.toDataURL('image/png'), x:0.5, y:1.0, w:12, h:4.5 })
  }

  pptx.writeFile({ fileName: `${hospitalName}_${year}년${month}월_보고서.pptx` })
  showToast('PPT 다운로드 완료!', 'success')
}
