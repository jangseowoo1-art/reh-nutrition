import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { verifyToken, hashPassword } from './utils/auth'
import { JWT_SECRET } from './middleware/auth'
import authRoute from './routes/auth'
import dashboardRoute from './routes/dashboard'
import ordersRoute from './routes/orders'
import mealsRoute from './routes/meals'
import vendorsRoute from './routes/vendors'
import settingsRoute from './routes/settings'
import scheduleRoute from './routes/schedule'
import adminRoute from './routes/admin'
import cardExpensesRoute from './routes/card_expenses'
import ceoDashboardRoute from './routes/ceo-dashboard'
import transactionRoute from './routes/transaction'
import executiveRoute from './routes/executive'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/static/*', serveStatic({ root: './' }))
// 정적 파일 캐시 (1시간) - 로컬 번들 파일의 빠른 서빙
app.use('/static/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'public, max-age=3600')
})
app.use('/api/*', cors())

// favicon - 빈 204로 브라우저 에러 방지
app.get('/favicon.ico', (c) => new Response(null, { status: 204 }))

// ── 인증 미들웨어 (API) ──────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  // 인증 불필요 경로
  if (c.req.path === '/api/auth/login') return next()
  // QR 공유 페이지용 public 라우트 (토큰 자체가 인증 수단)
  if (c.req.path.startsWith('/api/schedule/public/')) return next()
  // 팀 전체 스케줄 공개 라우트
  if (c.req.path.startsWith('/api/schedule/team-public/')) return next()
  
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  const payload = await verifyToken(token, JWT_SECRET)
  if (!payload) return c.json({ error: 'Invalid token' }, 401)
  
  c.set('user', payload)
  return next()
})

// ── API 라우트 ────────────────────────────────────────────────────
app.route('/api/auth', authRoute)
app.route('/api/dashboard', dashboardRoute)
app.route('/api/orders', ordersRoute)
app.route('/api/meals', mealsRoute)
app.route('/api/vendors', vendorsRoute)
app.route('/api/settings', settingsRoute)
app.route('/api/schedule', scheduleRoute)
app.route('/api/card-expenses', cardExpensesRoute)
app.route('/api/ceo-dashboard', ceoDashboardRoute)
app.route('/api/transaction', transactionRoute)
app.route('/api/executive', executiveRoute)

// ── 관리자 전용 API ───────────────────────────────────────────────
app.use('/api/admin/*', async (c, next) => {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  return next()
})
app.route('/api/admin', adminRoute)

// ── 페이지 라우트 ─────────────────────────────────────────────────
app.get('/login', (c) => c.html(getLoginPage()))
app.get('/', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/dashboard', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/orders', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/meals', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/schedule', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/analysis', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/settings', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/admin', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/report', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/hospital-manage', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/holiday-manage', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/ceo-dashboard', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/expense-doc', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/ingredient-prices', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/transaction-analysis', (c) => { c.header('Cache-Control','no-store'); return c.html(getAppShell()) })
app.get('/executive', (c) => { c.header('Cache-Control','no-store'); return c.html(getExecutiveShell()) })

// ── 직원용 개인 스케줄 공유 페이지 (QR 코드 스캔 후 표시) ──────
app.get('/my-schedule/:token', (c) => {
  c.header('Cache-Control', 'no-store')
  const token = c.req.param('token')
  return c.html(getMySchedulePage(token))
})

// ── 팀 전체 스케줄 공유 페이지 ─────────────────────────────────
app.get('/team-schedule/:token', (c) => {
  c.header('Cache-Control', 'no-store')
  const token = c.req.param('token')
  return c.html(getTeamSchedulePage(token))
})

// ── 전역 notFound / onError 핸들러 (500 방지) ────────────────────
app.notFound((c) => c.json({ error: 'Not Found' }, 404))
app.onError((err, c) => {
  console.error('API Error:', err?.message || err, err?.stack?.split('\n').slice(0,3).join(' | '))
  try {
    return c.json({ error: err?.message || 'Internal Server Error' }, 500)
  } catch(e2) {
    console.error('onError fallback:', e2)
    return new Response(JSON.stringify({ error: err?.message || 'Internal Server Error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})

export default app

// ── 로그인 페이지 HTML ────────────────────────────────────────────
function getLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>급식 예산 관리 - 로그인</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="/static/tailwind.min.js"></script>
<link href="/static/fontawesome.min.css" rel="stylesheet">
<style>
  body { background: linear-gradient(135deg, #1a4731 0%, #15803d 60%, #166534 100%); min-height: 100vh; }
  .login-card { backdrop-filter: blur(10px); background: rgba(255,255,255,0.97); }
  .btn-login { background: linear-gradient(135deg, #166534, #15803d); }
  .btn-login:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(21,128,61,0.4); }
</style>
</head>
<body class="flex items-center justify-center min-h-screen p-4">
<div class="login-card rounded-2xl shadow-2xl p-8 w-full max-w-md">
  <div class="text-center mb-8">
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style="background:linear-gradient(135deg,#1a4731,#16a34a)">
      <i class="fas fa-hospital text-white text-2xl"></i>
    </div>
    <h1 class="text-2xl font-bold text-gray-800">병원 급식 예산 관리</h1>
    <p class="text-gray-500 text-sm mt-1">Hospital Meal Budget System</p>
  </div>
  
  <div id="errorMsg" class="hidden bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm"></div>
  
  <form id="loginForm" class="space-y-4">
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">아이디</label>
      <div class="relative">
        <i class="fas fa-user absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input id="username" type="text" placeholder="아이디를 입력하세요"
          class="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
          autocomplete="username">
      </div>
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
      <div class="relative">
        <i class="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input id="password" type="password" placeholder="비밀번호를 입력하세요"
          class="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
          autocomplete="current-password">
      </div>
    </div>
    <div class="flex items-center justify-between">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input id="rememberMe" type="checkbox" class="w-4 h-4 accent-green-600 rounded">
        <span class="text-sm text-gray-600">아이디·비밀번호 저장</span>
      </label>
      <button type="button" onclick="clearSavedLogin()" class="text-xs text-gray-400 hover:text-red-500 transition-colors">저장 삭제</button>
    </div>
    <button type="submit" class="btn-login w-full text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-md mt-2">
      <i class="fas fa-sign-in-alt mr-2"></i>로그인
    </button>
  </form>
  
  <div class="mt-6 p-4 bg-gray-50 rounded-xl text-xs text-gray-500">
    <p class="font-medium mb-1">🔐 테스트 계정</p>
    <p>관리자: <span class="font-mono bg-white px-1 rounded">admin</span> / <span class="font-mono bg-white px-1 rounded">admin123</span></p>
    <p>병원: <span class="font-mono bg-white px-1 rounded">amina</span> / <span class="font-mono bg-white px-1 rounded">hospital1234</span></p>
  </div>
</div>

<script>
// 저장된 로그인 정보 불러오기
(function() {
  const saved = localStorage.getItem('savedLogin')
  if (saved) {
    try {
      const { username, password } = JSON.parse(saved)
      document.getElementById('username').value = username || ''
      document.getElementById('password').value = password || ''
      document.getElementById('rememberMe').checked = true
    } catch(e) {}
  }
})()

function clearSavedLogin() {
  localStorage.removeItem('savedLogin')
  document.getElementById('rememberMe').checked = false
  document.getElementById('username').value = ''
  document.getElementById('password').value = ''
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const username = document.getElementById('username').value
  const password = document.getElementById('password').value
  const rememberMe = document.getElementById('rememberMe').checked
  const errEl = document.getElementById('errorMsg')
  errEl.classList.add('hidden')

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (!res.ok) {
      errEl.textContent = data.error || '로그인 실패'
      errEl.classList.remove('hidden')
      return
    }
    // 자동저장 처리
    if (rememberMe) {
      localStorage.setItem('savedLogin', JSON.stringify({ username, password }))
    } else {
      localStorage.removeItem('savedLogin')
    }
    localStorage.setItem('token', data.token)
    localStorage.setItem('role', data.role)
    localStorage.setItem('hospitalName', data.hospitalName || '')
    localStorage.setItem('username', data.username)
    window.location.href = data.role === 'admin' ? '/admin' : data.role === 'executive' ? '/executive' : '/dashboard'
  } catch(err) {
    errEl.textContent = '서버 연결 오류'
    errEl.classList.remove('hidden')
  }
})
</script>
</body>
</html>`
}

// ── 앱 메인 쉘 HTML ────────────────────────────────────────────────
function getAppShell(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>병원 급식 예산 관리</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="/static/tailwind.min.js"></script>
<link href="/static/fontawesome.min.css" rel="stylesheet">
<script src="/static/chart.umd.min.js"></script>
<script src="/static/axios.min.js"></script>
<script src="/static/xlsx.bundle.js"></script>
<script src="/static/jspdf.umd.min.js" defer></script>
<link rel="stylesheet" href="/static/styles.css?v=20260330d">
</head>
<body class="bg-gray-50">

<!-- 모바일 사이드바 오버레이 -->
<div id="sidebarOverlay" class="sidebar-overlay" onclick="closeSidebar()"></div>

<!-- 사이드바 + 메인 레이아웃 -->
<div class="flex h-screen overflow-hidden">

  <!-- 사이드바 -->
  <aside id="sidebar" class="sidebar w-64 flex-shrink-0 flex flex-col">
    <!-- 로고 + 모바일 닫기 버튼 -->
    <div class="p-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-hospital text-white text-base"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-white font-bold text-sm leading-tight">급식 예산 관리</div>
          <div id="hospitalNameDisplay" class="text-white/60 text-xs mt-0.5 truncate">로딩중...</div>
        </div>
        <!-- 모바일 전용 닫기 버튼 -->
        <button onclick="closeSidebar()" class="sidebar-close-btn text-white/70 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>
    </div>

    <!-- 월 선택 -->
    <div class="px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <button onclick="changeMonth(-1)" class="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/20">
          <i class="fas fa-chevron-left text-xs"></i>
        </button>
        <div class="flex-1 text-center">
          <span id="currentMonthDisplay" class="text-white font-semibold text-sm"></span>
        </div>
        <button onclick="changeMonth(1)" class="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/20">
          <i class="fas fa-chevron-right text-xs"></i>
        </button>
      </div>
    </div>

    <!-- 메뉴 -->
    <nav class="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
      <div id="menuContainer"></div>
    </nav>

    <!-- 사용자 정보 + 로그아웃 -->
    <div class="p-3 border-t border-white/10">
      <div class="flex items-center gap-2 mb-2 px-1">
        <div class="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-user text-white text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div id="usernameDisplay" class="text-white text-xs font-medium truncate"></div>
          <div id="roleDisplay" class="text-white/50 text-xs"></div>
        </div>
      </div>
      <button onclick="logout()" class="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 text-xs transition active:bg-white/20">
        <i class="fas fa-sign-out-alt text-xs"></i><span>로그아웃</span>
      </button>
    </div>
  </aside>

  <!-- 메인 컨텐츠 -->
  <main class="flex-1 flex flex-col overflow-hidden min-w-0">
    <!-- 상단 헤더 -->
    <header class="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 flex-shrink-0 md:px-6 md:py-4">
      <!-- 모바일 햄버거 버튼 -->
      <button id="hamburgerBtn" onclick="openSidebar()" class="hamburger-btn w-9 h-9 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 flex-shrink-0">
        <i class="fas fa-bars text-base"></i>
      </button>
      <!-- 타이틀 -->
      <div class="flex-1 min-w-0">
        <h1 id="pageTitle" class="text-base font-bold text-gray-800 truncate md:text-xl"></h1>
        <p id="pageSubtitle" class="text-xs text-gray-500 truncate hidden md:block"></p>
      </div>
      <!-- 우측 정보 -->
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <span id="headerMonth" class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full font-medium md:text-sm md:px-3"></span>
        <button id="copyUrlBtn" onclick="copyServiceUrl()" title="서비스 URL 복사"
          class="hidden md:flex items-center gap-1.5 text-sm text-gray-500 bg-gray-100 hover:bg-green-100 hover:text-green-700 px-3 py-1 rounded-full transition-all duration-150 border border-transparent hover:border-green-300">
          <i class="fas fa-link text-xs"></i>
          <span id="copyUrlLabel">URL 복사</span>
        </button>
      </div>
    </header>

    <!-- 페이지 컨텐츠 -->
    <div id="pageContent" class="flex-1 overflow-y-auto p-3 md:p-6"></div>
    <!-- 발주/식수 입력: DOM 보존용 영구 패널 -->
    <div id="orders-panel" style="display:none" class="flex-1 overflow-y-auto p-2 md:p-6" style="overflow-x:hidden;min-width:0;box-sizing:border-box"></div>
    <div id="meals-panel"  style="display:none" class="flex-1 overflow-y-auto p-2 md:p-6"></div>
  </main>
</div>

<!-- 모바일 하단 네비게이션 바 -->
<nav id="mobileBottomNav" class="mobile-bottom-nav">
  <div id="mobileNavItems" class="flex justify-around items-center h-full px-1"></div>
</nav>

<script src="/static/app.js?v=20260401f"></script>
</body>
</html>`
}

// ── 운영진 전용 페이지 Shell ─────────────────────────────────────
function getExecutiveShell(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>운영 현황 대시보드</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<script src="/static/tailwind.min.js"></script>
<link href="/static/fontawesome.min.css" rel="stylesheet">
<script src="/static/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { background: #f0f4f8; font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif; }
  .exec-card { background: white; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .kpi-card { background: white; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); transition: transform 0.2s; }
  .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
  .gradient-blue { background: linear-gradient(135deg, #1e40af, #3b82f6); }
  .gradient-green { background: linear-gradient(135deg, #166534, #16a34a); }
  .gradient-amber { background: linear-gradient(135deg, #92400e, #d97706); }
  .gradient-purple { background: linear-gradient(135deg, #581c87, #9333ea); }
  .gradient-red { background: linear-gradient(135deg, #991b1b, #ef4444); }
  .progress-bar { height: 8px; border-radius: 4px; background: #e5e7eb; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; transition: width 0.8s ease; }
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .tab-active { border-bottom: 3px solid #1e40af; color: #1e40af; font-weight: 700; }
  .loading-spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 768px) {
    .hide-mobile { display: none !important; }
    .grid-mobile-1 { grid-template-columns: 1fr !important; }
  }
</style>
</head>
<body>
<!-- 헤더 -->
<header style="background:linear-gradient(135deg,#1a4731,#15803d)" class="sticky top-0 z-50 shadow-lg">
  <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
        <i class="fas fa-chart-line text-white"></i>
      </div>
      <div>
        <div id="execHospName" class="text-white font-bold text-base leading-tight">운영 현황</div>
        <div id="execPeriodLabel" class="text-green-200 text-xs">로딩 중...</div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <!-- 월 선택 -->
      <div class="flex items-center gap-1 bg-white/10 rounded-xl px-3 py-1.5">
        <button onclick="execChangeMonth(-1)" class="text-white/70 hover:text-white transition px-1">
          <i class="fas fa-chevron-left text-xs"></i>
        </button>
        <span id="execMonthDisplay" class="text-white text-sm font-semibold min-w-[70px] text-center"></span>
        <button onclick="execChangeMonth(1)" class="text-white/70 hover:text-white transition px-1">
          <i class="fas fa-chevron-right text-xs"></i>
        </button>
      </div>
      <!-- 새로고침 -->
      <button onclick="loadExecData()" class="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition" title="새로고침">
        <i class="fas fa-sync-alt text-sm" id="execRefreshIcon"></i>
      </button>
      <!-- 로그아웃 -->
      <button onclick="execLogout()" class="w-9 h-9 rounded-xl bg-white/10 hover:bg-red-500/40 flex items-center justify-center text-white transition" title="로그아웃">
        <i class="fas fa-sign-out-alt text-sm"></i>
      </button>
    </div>
  </div>
</header>

<!-- 메인 콘텐츠 -->
<main class="max-w-7xl mx-auto px-4 py-6" id="execMain">
  <!-- 로딩 -->
  <div id="execLoading" class="flex items-center justify-center py-20">
    <div class="text-center">
      <i class="fas fa-circle-notch text-4xl text-green-600 loading-spin mb-3 block"></i>
      <p class="text-gray-500">데이터 불러오는 중...</p>
    </div>
  </div>
  <!-- 콘텐츠 영역 -->
  <div id="execContent" class="hidden space-y-6"></div>
</main>

<script src="/static/executive.js?v=20260330d"></script>
</body>
</html>`
}

// ── 직원용 개인 스케줄 모바일 페이지 ──────────────────────────
function getMySchedulePage(token: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>내 근무표</title>
<link rel="stylesheet" href="/static/fontawesome.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;min-height:100vh;}
.header{background:linear-gradient(135deg,#166534,#15803d);color:white;padding:16px 20px;position:sticky;top:0;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.2);}
.header h1{font-size:18px;font-weight:700;}
.header .sub{font-size:12px;opacity:.8;margin-top:2px;}
.month-nav{display:flex;align-items:center;gap:8px;background:white;padding:10px 16px;border-bottom:1px solid #e5e7eb;}
.month-nav button{width:32px;height:32px;border:1px solid #d1d5db;border-radius:8px;background:white;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;}
.month-nav .month-label{flex:1;text-align:center;font-weight:700;font-size:15px;color:#166534;}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 16px;background:white;border-bottom:1px solid #e5e7eb;}
.stat-card{background:#f9fafb;border-radius:10px;padding:10px;text-align:center;}
.stat-card .val{font-size:22px;font-weight:800;color:#166534;}
.stat-card .lbl{font-size:10px;color:#6b7280;margin-top:2px;}
.calendar{padding:12px 16px 80px;}
.cal-header{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;}
.cal-header div{text-align:center;font-size:10px;font-weight:700;color:#6b7280;padding:4px 0;}
.cal-header div.sun{color:#ef4444;}
.cal-header div.sat{color:#3b82f6;}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
.cal-day{min-height:56px;border-radius:10px;padding:4px;display:flex;flex-direction:column;align-items:center;gap:2px;background:white;border:1px solid #f3f4f6;}
.cal-day.empty{background:transparent;border-color:transparent;}
.cal-day.today .day-num{background:#166534;color:white;border-radius:50%;}
.cal-day.off-day{background:#fff1f2;}
.cal-day .day-num{width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#374151;}
.cal-day.sun .day-num{color:#ef4444;}
.cal-day.sat .day-num{color:#3b82f6;}
.shift-badge{padding:2px 6px;border-radius:5px;font-size:9px;font-weight:700;width:100%;text-align:center;max-width:38px;}
.code-legend{display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px;background:white;border-bottom:1px solid #e5e7eb;}
.legend-item{display:flex;align-items:center;gap:4px;font-size:10px;color:#374151;}
.legend-dot{width:10px;height:10px;border-radius:3px;}
.bottom-bar{position:fixed;bottom:0;left:0;right:0;background:white;border-top:1px solid #e5e7eb;padding:12px 16px;display:flex;gap:8px;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,.08);}
.btn-print{flex:1;padding:10px;border-radius:10px;background:#166534;color:white;border:none;font-size:13px;font-weight:700;cursor:pointer;}
.btn-share{padding:10px 14px;border-radius:10px;background:#f3f4f6;color:#374151;border:none;font-size:13px;cursor:pointer;}
.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:12px;}
.spinner{width:40px;height:40px;border:4px solid #d1fae5;border-top-color:#166534;border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.error-box{margin:20px;padding:20px;background:#fff1f2;border-radius:12px;text-align:center;color:#b91c1c;}
.change-log{background:white;margin:0 0 80px;border-top:4px solid #f0fdf4;}
.change-log-header{padding:12px 16px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;border-bottom:1px solid #f3f4f6;}
.change-log-header span{font-size:13px;font-weight:700;color:#374151;flex:1;}
.change-log-body{padding:0 16px 12px;}
.change-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f9fafb;font-size:12px;}
.change-item:last-child{border-bottom:none;}
@media print{.bottom-bar,.month-nav button,.change-log{display:none!important;} body{background:white;} .header{background:#166534 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style>
</head>
<body>
<div id="app">
  <div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">근무표 불러오는 중...</p></div>
</div>
<script>
const TOKEN = '${token}'
let curY = new Date().getFullYear(), curM = new Date().getMonth()+1

async function load() {
  document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">불러오는 중...</p></div>'
  try {
    const r = await fetch('/api/schedule/public/'+TOKEN+'?year='+curY+'&month='+curM)
    if (!r.ok) throw new Error('유효하지 않은 링크입니다')
    render(await r.json())
  } catch(e) {
    document.getElementById('app').innerHTML = '<div class="error-box"><i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block"></i><b>오류</b><p style="margin-top:6px;font-size:13px;">'+e.message+'</p></div>'
  }
}

function style(code, shifts) {
  if (!code) return ''
  const sf = shifts.find(s => s.shift_code === code)
  if (sf && sf.color) return 'background:'+sf.color+'22;color:'+sf.color
  const m = {'연':'background:#fef9c3;color:#92400e','휴':'background:#fee2e2;color:#b91c1c','오전':'background:#ede9fe;color:#6d28d9','오후':'background:#dbeafe;color:#1d4ed8','경조':'background:#fce7f3;color:#9d174d','OT':'background:#ecfdf5;color:#065f46'}
  return m[code] || 'background:#f3f4f6;color:#374151'
}

function render(d) {
  const {employee:emp, hospital, year, month, schedMap, workDays, codeCount, shifts, totalDays, changeLog} = d
  const td = new Date(), todayStr = td.getFullYear()+'-'+String(td.getMonth()+1).padStart(2,'0')+'-'+String(td.getDate()).padStart(2,'0')

  // 페이지 타이틀 업데이트
  document.title = emp.name + ' 님의 근무표 | ' + hospital.name

  const legend = shifts.filter(s=>s.shift_code).map(s=>'<div class="legend-item"><div class="legend-dot" style="background:'+s.color+'33;border:1.5px solid '+s.color+'"></div><span>'+s.shift_code+(s.shift_name&&s.shift_name!==s.shift_code?' ('+s.shift_name+')':'')+'</span></div>').join('')+
    ['연','휴'].map(c=>{const s=style(c,[]);const bg=s.match(/background:([^;]+)/);return '<div class="legend-item"><div class="legend-dot" style="background:'+(bg?bg[1]:'#eee')+'"></div><span>'+c+'</span></div>'}).join('')

  const statsItems = Object.entries(codeCount).slice(0,2).map(([k,v])=>'<div class="stat-card"><div class="val" style="font-size:18px">'+v+'</div><div class="lbl">'+k+'</div></div>').join('')

  const firstDow = new Date(year, month-1, 1).getDay()
  let cells = ''
  for (let i=0;i<firstDow;i++) cells += '<div class="cal-day empty"></div>'
  for (let day=1;day<=totalDays;day++) {
    const ds = year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
    const dow = new Date(year,month-1,day).getDay()
    const code = (schedMap[ds] && schedMap[ds].shift_code) || ''
    const isOff = code==='연'||code==='휴'
    const cls = 'cal-day'+(dow===0?' sun':'')+(dow===6?' sat':'')+(isOff?' off-day':'')+(ds===todayStr?' today':'')
    const st = style(code, shifts)
    cells += '<div class="'+cls+'"><div class="day-num">'+day+'</div>'+(code?'<div class="shift-badge" style="'+st+'">'+code+'</div>':(dow===0?'<div style="font-size:8px;color:#fca5a5">휴</div>':''))+'</div>'
  }

  // 변경 이력 섹션
  const logs = changeLog || []
  let changeHtml = ''
  if (logs.length > 0) {
    const items = logs.map(lg => {
      const dt = lg.work_date  // 'YYYY-MM-DD'
      const [y2,m2,d2] = dt.split('-')
      const dateStr = parseInt(m2)+'월 '+parseInt(d2)+'일'
      const oldTxt = lg.old_shift_code || '없음'
      const newTxt = lg.new_shift_code || '삭제'
      const oldSt = style(lg.old_shift_code, shifts)
      const newSt = style(lg.new_shift_code, shifts)
      const timeStr = lg.changed_at ? lg.changed_at.slice(0,16).replace('T',' ') : ''
      return '<div class="change-item">'+
        '<div style="width:52px;font-weight:700;color:#374151;flex-shrink:0">'+dateStr+'</div>'+
        '<div style="padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px;'+(oldSt||'background:#f3f4f6;color:#9ca3af')+'">'+oldTxt+'</div>'+
        '<i class="fas fa-arrow-right" style="color:#9ca3af;font-size:10px;flex-shrink:0"></i>'+
        '<div style="padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px;'+(newSt||'background:#f3f4f6;color:#9ca3af')+'">'+newTxt+'</div>'+
        '<div style="margin-left:auto;font-size:10px;color:#9ca3af;flex-shrink:0">'+timeStr+'</div>'+
        '</div>'
    }).join('')
    changeHtml = '<div class="change-log">'+
      '<div class="change-log-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">'+
      '<i class="fas fa-history" style="color:#166534;font-size:13px"></i>'+
      '<span>최근 스케줄 변경 이력 ('+logs.length+'건)</span>'+
      '<i class="fas fa-chevron-down" style="color:#9ca3af;font-size:11px"></i>'+
      '</div>'+
      '<div class="change-log-body">'+items+'</div>'+
      '</div>'
  }

  document.getElementById('app').innerHTML =
    '<div class="header"><div style="display:flex;align-items:center;gap:10px"><div style="width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-user" style="font-size:16px"></i></div><div><h1 style="font-size:17px;font-weight:800"><span style="opacity:.9;font-weight:500;font-size:14px">'+emp.name+'</span> 님의 근무표</h1><div class="sub">'+hospital.name+(emp.position?' · '+emp.position:'')+'</div></div></div></div>'+
    '<div class="month-nav"><button onclick="prev()"><i class="fas fa-chevron-left"></i></button><div class="month-label">'+year+'년 '+month+'월</div><button onclick="next()"><i class="fas fa-chevron-right"></i></button></div>'+
    '<div class="stats"><div class="stat-card"><div class="val">'+workDays+'</div><div class="lbl">근무일수</div></div>'+statsItems+'</div>'+
    '<div class="code-legend">'+legend+'</div>'+
    '<div class="calendar"><div class="cal-header"><div class="sun">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div class="sat">토</div></div><div class="cal-grid">'+cells+'</div></div>'+
    changeHtml+
    '<div class="bottom-bar"><button class="btn-print" onclick="window.print()"><i class="fas fa-print" style="margin-right:6px"></i>인쇄 / PDF 저장</button><button class="btn-share" onclick="share()" title="링크 복사"><i class="fas fa-share-alt"></i></button></div>'
}

function prev(){curM--;if(curM<1){curM=12;curY--}load()}
function next(){curM++;if(curM>12){curM=1;curY++}load()}
function share(){const u=location.href;if(navigator.share)navigator.share({title:'내 근무표',url:u});else if(navigator.clipboard)navigator.clipboard.writeText(u).then(()=>alert('링크가 복사되었습니다'))}
load()
</script>
</body>
</html>`
}

// ── 전체 팀 스케줄 공유 페이지 ────────────────────────────────
function getTeamSchedulePage(token: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>전체 근무표</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link href="/static/fontawesome.min.css" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;min-height:100vh;}
.header{background:linear-gradient(135deg,#166534,#15803d);color:white;padding:14px 16px;position:sticky;top:0;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.15);}
.header h1{font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px;}
.header .sub{font-size:11px;opacity:.8;margin-top:3px;}
.month-nav{display:flex;align-items:center;gap:8px;background:white;padding:10px 16px;border-bottom:1px solid #e5e7eb;}
.month-nav button{width:32px;height:32px;border:1px solid #d1d5db;border-radius:8px;background:white;cursor:pointer;font-size:14px;}
.month-label{flex:1;text-align:center;font-weight:700;font-size:15px;color:#166534;}
.wrap{padding:12px 16px 24px;overflow-x:auto;}
table{width:100%;border-collapse:collapse;min-width:600px;font-size:11px;}
thead th{background:#166534;color:white;padding:7px 4px;text-align:center;font-weight:700;position:sticky;top:0;}
thead th.sun{background:#b91c1c;}
thead th.sat{background:#1d4ed8;}
tbody tr:nth-child(even){background:#f9fafb;}
tbody tr:hover{background:#f0fdf4;}
td{padding:5px 3px;text-align:center;border:1px solid #f1f5f9;vertical-align:middle;}
td.name-cell{text-align:left;padding:5px 8px;font-weight:700;white-space:nowrap;background:white;position:sticky;left:0;z-index:1;border-right:2px solid #e5e7eb;}
td.name-cell .pos{font-size:9px;color:#9ca3af;font-weight:400;}
.badge{display:inline-block;padding:2px 5px;border-radius:4px;font-size:9px;font-weight:700;width:100%;max-width:32px;}
.team-divider td{background:#f0fdf4;font-size:10px;font-weight:700;color:#166534;padding:4px 8px;}
.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:12px;}
.spinner{width:36px;height:36px;border:4px solid #d1fae5;border-top-color:#166534;border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.error-box{margin:20px;padding:20px;background:#fff1f2;border-radius:12px;text-align:center;color:#b91c1c;}
.legend{display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px;background:white;border-bottom:1px solid #e5e7eb;}
.legend-item{display:flex;align-items:center;gap:4px;font-size:10px;}
.legend-dot{width:10px;height:10px;border-radius:3px;}
@media print{.month-nav button{display:none!important;} body{background:white;} .header{background:#166534!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style>
</head>
<body>
<div id="app">
  <div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">근무표 불러오는 중...</p></div>
</div>
<script>
const TOKEN = '${token}'
let curY = new Date().getFullYear(), curM = new Date().getMonth()+1

async function load() {
  document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">불러오는 중...</p></div>'
  try {
    const r = await fetch('/api/schedule/team-public/'+TOKEN+'?year='+curY+'&month='+curM)
    if (!r.ok) throw new Error('유효하지 않은 링크입니다')
    render(await r.json())
  } catch(e) {
    document.getElementById('app').innerHTML = '<div class="error-box"><i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block"></i><b>오류</b><p style="margin-top:6px;font-size:13px;">'+e.message+'</p></div>'
  }
}

function shiftStyle(code, shifts) {
  if (!code) return ''
  const sf = shifts.find(s => s.shift_code === code)
  if (sf && sf.color) return 'background:'+sf.color+'22;color:'+sf.color
  const m = {'연':'background:#fef9c3;color:#92400e','휴':'background:#fee2e2;color:#b91c1c','경조':'background:#fce7f3;color:#9d174d'}
  return m[code] || 'background:#f3f4f6;color:#374151'
}

function render(d) {
  const {hospital, year, month, totalDays, employees, schedMap, shifts} = d
  document.title = hospital.name + ' 전체 근무표'

  // 요일 헤더
  const days = []
  for(let day=1;day<=totalDays;day++){
    const dow = new Date(year,month-1,day).getDay()
    days.push({day,dow})
  }

  const thCells = days.map(({day,dow})=>{
    const cls = dow===0?'sun':dow===6?'sat':''
    return '<th class="'+cls+'">'+day+'<br><span style="font-size:8px;font-weight:400">'+['일','월','화','수','목','금','토'][dow]+'</span></th>'
  }).join('')

  // 팀 구분
  const cookTeam = employees.filter(e=>e.team==='cook')
  const nutriTeam = employees.filter(e=>e.team!=='cook')

  function empRows(emps) {
    return emps.map(emp=>{
      const sm = schedMap[emp.id] || {}
      const cells = days.map(({day,dow})=>{
        const ds = year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
        const code = sm[ds] || ''
        const st = shiftStyle(code, shifts)
        const isOff = code==='연'||code==='휴'
        const isSun = dow===0
        const bg = isSun&&!code ? 'background:#fff1f2;' : ''
        return '<td style="'+bg+'"><span class="badge" style="'+st+'">'+(code||(isSun?'휴':'-'))+'</span></td>'
      }).join('')
      return '<tr><td class="name-cell">'+emp.name+'<br><span class="pos">'+(emp.position||'')+'</span></td>'+cells+'</tr>'
    }).join('')
  }

  const legend = shifts.filter(s=>s.shift_code).map(s=>
    '<div class="legend-item"><div class="legend-dot" style="background:'+s.color+'33;border:1.5px solid '+s.color+'"></div><span>'+s.shift_code+(s.shift_name&&s.shift_name!==s.shift_code?' ('+s.shift_name+')':'')+'</span></div>'
  ).join('')+'<div class="legend-item"><div class="legend-dot" style="background:#fef9c3;border:1.5px solid #92400e"></div><span>연</span></div><div class="legend-item"><div class="legend-dot" style="background:#fee2e2;border:1.5px solid #b91c1c"></div><span>휴</span></div>'

  document.getElementById('app').innerHTML =
    '<div class="header"><h1><i class="fas fa-users" style="font-size:14px"></i>'+hospital.name+'</h1><div class="sub"><i class="fas fa-calendar-alt" style="margin-right:4px"></i>'+year+'년 '+month+'월 전체 근무표</div></div>'+
    '<div class="month-nav"><button onclick="prev()"><i class="fas fa-chevron-left"></i></button><div class="month-label">'+year+'년 '+month+'월</div><button onclick="next()"><i class="fas fa-chevron-right"></i></button></div>'+
    '<div class="legend">'+legend+'</div>'+
    '<div class="wrap"><table>'+
      '<thead><tr><th style="min-width:72px;text-align:left;padding-left:8px">이름</th>'+thCells+'</tr></thead>'+
      '<tbody>'+
      (cookTeam.length>0?'<tr class="team-divider"><td colspan="'+(totalDays+1)+'"><i class="fas fa-utensils" style="margin-right:4px"></i>조리팀</td></tr>'+empRows(cookTeam):'')+
      (nutriTeam.length>0?'<tr class="team-divider"><td colspan="'+(totalDays+1)+'"><i class="fas fa-apple-alt" style="margin-right:4px"></i>영양팀</td></tr>'+empRows(nutriTeam):'')+
      '</tbody></table></div>'+
    '<div style="text-align:center;padding:16px;"><button onclick="window.print()" style="padding:10px 24px;background:#166534;color:white;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer"><i class="fas fa-print" style="margin-right:6px"></i>인쇄 / PDF 저장</button></div>'
}

function prev(){curM--;if(curM<1){curM=12;curY--}load()}
function next(){curM++;if(curM>12){curM=1;curY++}load()}
load()
</script>
</body>
</html>`
}
