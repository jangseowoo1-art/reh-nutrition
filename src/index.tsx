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
      '<div class="change-log-header" onclick="toggleChangeLog(this)">'+
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
function toggleChangeLog(el){const b=el.nextElementSibling;if(b)b.style.display=b.style.display==='none'?'block':'none'}
load()
</script>
</body>
</html>`
}

// ── 전체 팀 스케줄 공유 페이지 (직원 공유 뷰) ─────────────────
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
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4ff;font-size:12px;}
.page-header{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:white;padding:12px 16px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.2);}
.page-header h1{font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px;}
.page-header .sub{font-size:11px;opacity:.75;margin-top:3px;display:flex;align-items:center;gap:12px;}
.month-bar{display:flex;align-items:center;gap:8px;background:white;padding:8px 14px;border-bottom:2px solid #e5e7eb;}
.month-bar button.nav-btn{width:28px;height:28px;border:1px solid #d1d5db;border-radius:6px;background:white;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;}
.month-bar button.nav-btn:hover{background:#f3f4f6;}
.month-label{flex:1;text-align:center;font-weight:800;font-size:14px;color:#1e3a8a;}
.btn-print{padding:5px 12px;background:#1e3a8a;color:white;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;}
.btn-print:hover{background:#1e40af;}
.legend-bar{display:flex;flex-wrap:wrap;gap:6px;padding:7px 14px;background:white;border-bottom:1px solid #e5e7eb;font-size:10px;}
.leg{display:flex;align-items:center;gap:3px;}
.leg-dot{width:12px;height:12px;border-radius:3px;flex-shrink:0;}
.scroll-wrap{overflow-x:auto;overflow-y:visible;padding-bottom:32px;}
/* 팀 섹션 */
.team-section{margin:10px 10px 0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);}
.team-header{padding:8px 12px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:8px;}
.team-badge-label{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;}
.team-count{font-size:10px;opacity:.7;font-weight:500;}
/* 테이블 */
table{border-collapse:collapse;font-size:10.5px;width:100%;}
th.name-th,td.name-td{position:sticky;left:0;z-index:20;min-width:88px;max-width:110px;background:white;border-right:2px solid #d1d5db;padding:0 8px;white-space:nowrap;}
th.name-th{z-index:30;color:white;text-align:left;padding:5px 8px;}
td.name-td{font-weight:700;color:#1e293b;vertical-align:middle;}
td.name-td .emp-name{font-size:11px;font-weight:800;display:block;}
td.name-td .emp-pos{font-size:9px;color:#94a3b8;font-weight:400;display:block;margin-top:1px;}
/* 날짜 헤더 행 */
tr.date-hdr-row th{background:#334155;color:white;padding:4px 2px;text-align:center;font-size:10px;font-weight:700;min-width:28px;border-right:1px solid rgba(255,255,255,.1);}
tr.date-hdr-row th.sun-h{background:#991b1b;}
tr.date-hdr-row th.sat-h{background:#1d4ed8;}
tr.date-hdr-row th.hol-h{background:#991b1b;}
tr.date-hdr-row th.today-h{background:#d97706;}
tr.date-hdr-row th.stat-th{background:#1e293b;min-width:38px;font-size:9px;}
/* 직원 행 */
tr.emp-row{border-bottom:1px solid #f1f5f9;}
tr.emp-row:hover{background:#f0f9ff;}
tr.emp-row td{padding:3px 2px;text-align:center;border-right:1px solid #f1f5f9;vertical-align:middle;height:32px;}
tr.emp-row td.sun-cell{background:#fff8f8;}
tr.emp-row td.today-cell{background:#fffbeb;}
/* 뱃지 */
.badge{display:inline-flex;align-items:center;justify-content:center;width:26px;height:20px;border-radius:4px;font-size:9px;font-weight:800;line-height:1;}
.badge-empty{color:#e2e8f0;}
.badge-sun{color:#fca5a5;font-size:8px;}
/* 통계 */
td.stat-td{font-weight:700;font-size:10px;color:#374151;background:#f8fafc;border-left:1px solid #e2e8f0;padding:2px 4px;vertical-align:middle;}
td.stat-td .sv{font-size:12px;font-weight:800;color:#1e3a8a;display:block;text-align:center;}
td.stat-td .sl{font-size:8px;color:#94a3b8;display:block;text-align:center;}
td.stat-td .code-chips{display:flex;flex-wrap:wrap;gap:2px;justify-content:center;}
td.stat-td .chip{font-size:8px;padding:1px 4px;border-radius:3px;font-weight:700;}
/* 로딩/에러 */
.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:12px;}
.spinner{width:40px;height:40px;border:4px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.error-box{margin:20px;padding:20px;background:#fff1f2;border-radius:12px;text-align:center;color:#b91c1c;}
@media print{
  .month-bar button,.btn-print{display:none!important;}
  .page-header,.team-header{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  tr.date-hdr-row th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{background:white;}
  .scroll-wrap{overflow:visible;}
  .team-section{box-shadow:none;border:1px solid #e5e7eb;}
}
</style>
</head>
<body>
<div id="app">
  <div class="loading"><div class="spinner"></div><p style="color:#6b7280;font-size:13px;">근무표 불러오는 중...</p></div>
</div>
<script>
const TOKEN = '${token}'
let curY = new Date().getFullYear(), curM = new Date().getMonth()+1

const KR_HOLIDAYS = {
  '01-01':1,'03-01':1,'05-05':1,'06-06':1,'08-15':1,
  '10-03':1,'10-09':1,'12-25':1
}
function isHol(m, d) {
  return !!KR_HOLIDAYS[String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')]
}

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

function shiftSt(code, shifts) {
  if (!code) return null
  const sf = shifts.find(s => s.shift_code === code)
  if (sf && sf.color) return {bg:sf.color+'22',color:sf.color}
  const m = {
    '연':{bg:'#fef9c3',color:'#92400e'},
    '휴':{bg:'#fee2e2',color:'#b91c1c'},
    '경조':{bg:'#fce7f3',color:'#9d174d'},
    'OT':{bg:'#ecfdf5',color:'#065f46'}
  }
  return m[code] || {bg:'#f3f4f6',color:'#374151'}
}

const TEAM_CFG = {
  'nutrition_manager':{label:'영양사',icon:'fa-star',color:'#b45309',bg:'#fef3c7',border:'#f59e0b'},
  'cook':             {label:'조리/셰프',icon:'fa-crown',color:'#6d28d9',bg:'#ede9fe',border:'#8b5cf6'},
  'assistant_cook':   {label:'조리사',icon:'fa-utensils',color:'#0369a1',bg:'#e0f2fe',border:'#0ea5e9'},
  'helper':           {label:'조리원',icon:'fa-hands-helping',color:'#065f46',bg:'#d1fae5',border:'#10b981'},
  'manager':          {label:'매니저',icon:'fa-user-tie',color:'#4338ca',bg:'#e0e7ff',border:'#6366f1'},
  'default':          {label:'기타',icon:'fa-user',color:'#374151',bg:'#f3f4f6',border:'#9ca3af'}
}
const TEAM_ORDER = ['nutrition_manager','cook','assistant_cook','helper','manager','default']

function render(d) {
  const {hospital, year, month, totalDays, employees, schedMap, shifts} = d
  document.title = hospital.name + ' ' + year + '년 ' + month + '월 전체 근무표'

  const today = new Date()
  const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0')

  // 날짜 목록
  const days = []
  for(let day=1; day<=totalDays; day++){
    const dow = new Date(year, month-1, day).getDay()
    const hol = isHol(month, day)
    const ds = year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
    days.push({day, dow, hol, ds})
  }

  // 팀별 그룹핑
  const teamMap = {}
  employees.forEach(emp => {
    const pos = (emp.position||'').toLowerCase()
    let team = 'default'
    if (pos.includes('영양')) team = 'nutrition_manager'
    else if (pos.includes('셰프')||pos.includes('책임')) team = 'cook'
    else if (pos.includes('조리사')) team = 'assistant_cook'
    else if (pos.includes('조리원')) team = 'helper'
    else if (pos.includes('매니저')) team = 'manager'
    else if (emp.team && emp.team in TEAM_CFG) team = emp.team
    if (!teamMap[team]) teamMap[team] = []
    teamMap[team].push(emp)
  })

  // 범례
  const legend = shifts.filter(s=>s.shift_code).map(s=>{
    const st = shiftSt(s.shift_code, shifts)
    return '<div class="leg"><div class="leg-dot" style="background:'+st.bg+';border:1.5px solid '+st.color+'"></div><span>'+s.shift_code+(s.shift_name&&s.shift_name!==s.shift_code?' ('+s.shift_name+')':'')+'</span></div>'
  }).join('')+
    '<div class="leg"><div class="leg-dot" style="background:#fef9c3;border:1.5px solid #92400e"></div><span>연</span></div>'+
    '<div class="leg"><div class="leg-dot" style="background:#fee2e2;border:1.5px solid #b91c1c"></div><span>휴</span></div>'+
    '<div class="leg"><div class="leg-dot" style="background:#fce7f3;border:1.5px solid #9d174d"></div><span>경조</span></div>'

  // 날짜 헤더 셀 (팀별 공통)
  const thDays = days.map(({day, dow, hol, ds}) => {
    const isToday = ds === todayStr
    const cls = isToday?'today-h':(dow===0||hol)?'sun-h':dow===6?'sat-h':''
    const dowStr = ['일','월','화','수','목','금','토'][dow]
    return '<th class="'+cls+'">'+day+'<br><span style="font-size:7.5px;opacity:.85;font-weight:500">'+dowStr+'</span></th>'
  }).join('')
  const thStat = '<th class="stat-th">근무</th><th class="stat-th">휴가</th><th class="stat-th" style="min-width:52px">코드</th>'

  // 팀 섹션 HTML 생성
  let sectionsHtml = ''
  TEAM_ORDER.forEach(teamKey => {
    const emps = teamMap[teamKey]
    if (!emps || emps.length === 0) return
    const tc = TEAM_CFG[teamKey]

    // 팀 헤더
    let html = '<div class="team-section" style="border:1.5px solid '+tc.border+'">'
    html += '<div class="team-header" style="background:'+tc.bg+';">'
    html += '<span class="team-badge-label" style="background:white;color:'+tc.color+';border:1.5px solid '+tc.border+'"><i class="fas '+tc.icon+'"></i>'+tc.label+'</span>'
    html += '<span class="team-count" style="color:'+tc.color+'">'+emps.length+'명</span>'
    html += '</div>'

    // 테이블
    html += '<div class="scroll-wrap"><table>'
    // 날짜 헤더행
    html += '<thead><tr class="date-hdr-row">'
    html += '<th class="name-th" style="background:'+tc.color+';text-align:left;font-size:10px">이름/직위</th>'
    html += thDays + thStat
    html += '</tr></thead><tbody>'

    // 직원 행
    emps.forEach(emp => {
      const sm = schedMap[emp.id] || {}
      let workDays = 0, offDays = 0
      const codeCnt = {}

      const cells = days.map(({day, dow, hol, ds}) => {
        const code = sm[ds] || ''
        const isToday = ds === todayStr
        const isSunOrHol = dow === 0 || hol

        if (code === '연' || code === '휴' || code === '경조') offDays++
        else if (code) { workDays++; codeCnt[code] = (codeCnt[code]||0)+1 }

        const st = shiftSt(code, shifts)
        let badgeHtml = ''
        if (code) {
          badgeHtml = '<span class="badge" style="background:'+st.bg+';color:'+st.color+'">'+code+'</span>'
        } else if (isSunOrHol) {
          badgeHtml = '<span class="badge badge-sun">휴</span>'
        } else {
          badgeHtml = '<span class="badge badge-empty">-</span>'
        }

        const tdCls = isToday ? 'today-cell' : isSunOrHol && !code ? 'sun-cell' : ''
        return '<td class="'+tdCls+'">'+badgeHtml+'</td>'
      }).join('')

      const chips = Object.entries(codeCnt).map(([k,v]) => {
        const st = shiftSt(k, shifts)
        return '<span class="chip" style="background:'+(st?st.bg:'#e0e7ff')+';color:'+(st?st.color:'#3730a3')+'">'+k+' '+v+'</span>'
      }).join('')

      html += '<tr class="emp-row">'
      html += '<td class="name-td" style="background:white"><span class="emp-name">'+emp.name+'</span><span class="emp-pos">'+(emp.position||'')+'</span></td>'
      html += cells
      html += '<td class="stat-td"><span class="sv">'+workDays+'</span><span class="sl">일</span></td>'
      html += '<td class="stat-td"><span class="sv">'+offDays+'</span><span class="sl">일</span></td>'
      html += '<td class="stat-td"><div class="code-chips">'+chips+'</div></td>'
      html += '</tr>'
    })

    html += '</tbody></table></div></div>'
    sectionsHtml += html
  })

  document.getElementById('app').innerHTML =
    '<div class="page-header">'+
      '<h1><i class="fas fa-hospital" style="font-size:13px"></i>'+hospital.name+'</h1>'+
      '<div class="sub">'+
        '<span><i class="fas fa-calendar-alt"></i>'+year+'년 '+month+'월 전체 근무표</span>'+
        '<span><i class="fas fa-users"></i>총 '+employees.length+'명</span>'+
        '<span style="opacity:.6;font-size:10px"><i class="fas fa-share-alt"></i>직원 공유 뷰</span>'+
      '</div>'+
    '</div>'+
    '<div class="month-bar">'+
      '<button class="nav-btn" onclick="prev()"><i class="fas fa-chevron-left"></i></button>'+
      '<div class="month-label">'+year+'년 '+month+'월</div>'+
      '<button class="nav-btn" onclick="next()"><i class="fas fa-chevron-right"></i></button>'+
      '<button class="btn-print" onclick="window.print()"><i class="fas fa-print"></i>인쇄/PDF</button>'+
    '</div>'+
    '<div class="legend-bar">'+legend+'</div>'+
    sectionsHtml +
    '<div style="height:20px"></div>'
}

function prev(){curM--;if(curM<1){curM=12;curY--}load()}
function next(){curM++;if(curM>12){curM=1;curY++}load()}
load()
</script>
</body>
</html>`
}
