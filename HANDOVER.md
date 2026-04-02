# 🏥 병원 급식 예산 관리 시스템 — 개발자 인수인계 문서

> **작성일**: 2026-04-02  
> **버전**: v2.0  
> **대상**: 신규 개발자 / 유지보수 담당자  
> **작성 목적**: 현재 운영 중인 시스템의 구조, 색상 체계, 기능 히스토리, 알려진 이슈를 인수인계

---

## 📋 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택 & 인프라](#2-기술-스택--인프라)
3. [프로젝트 구조](#3-프로젝트-구조)
4. [디자인 시스템 (색상 & UI 규칙)](#4-디자인-시스템-색상--ui-규칙)
5. [사용자 역할 체계](#5-사용자-역할-체계)
6. [메뉴 구조](#6-메뉴-구조)
7. [화면별 기능 상세](#7-화면별-기능-상세)
8. [백엔드 API 구조](#8-백엔드-api-구조)
9. [데이터베이스 구조](#9-데이터베이스-구조)
10. [핵심 계산 로직](#10-핵심-계산-로직)
11. [기능 개발 히스토리](#11-기능-개발-히스토리)
12. [알려진 이슈 & 수정 필요 항목](#12-알려진-이슈--수정-필요-항목)
13. [개발 환경 설정](#13-개발-환경-설정)
14. [배포 방법](#14-배포-방법)
15. [주의사항 & 개발 원칙](#15-주의사항--개발-원칙)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **시스템명** | 병원 급식 예산 관리 시스템 |
| **목적** | 병원 영양사의 급식 예산·발주·식수·스케줄을 통합 관리하고 관리자/경영진에게 대시보드 제공 |
| **주요 사용자** | 병원 영양사, 시스템 관리자, 운영진(executive), 경영진(CEO) |
| **운영 URL** | Cloudflare Pages 배포 (wrangler project: `hospital-meal-budget`) |
| **DB** | Cloudflare D1 SQLite (`hospital-meal-production`) |

---

## 2. 기술 스택 & 인프라

```
Frontend:  Vanilla JavaScript (SPA 방식, 프레임워크 없음)
           TailwindCSS (CDN), Font Awesome (CDN), Chart.js (CDN)
           jsPDF (로컬 번들: public/static/jspdf.umd.min.js)
           NanumGothic 폰트 (로컬: public/static/NanumGothic.ttf, .b64.txt)

Backend:   Hono Framework (TypeScript)
           Cloudflare Workers + Pages

Database:  Cloudflare D1 (SQLite 호환)
           DB Binding: "DB"
           DB Name:    hospital-meal-production
           DB ID:      8cd39977b63bb3122ba4bce948af09ffc1cd80e74253123a1208272811ea0b15

Build:     Vite + @hono/vite-cloudflare-pages
           빌드 후 app.js / styles.css 수동 복사 (package.json build 스크립트 참고)

인증:      JWT 토큰 (Authorization: Bearer {token})
           localStorage에 token, role, hospitalName, username 저장
```

### 빌드 명령

```bash
# 빌드
npm run build
# → vite build 후 public/static/app.js, styles.css → dist/static/ 복사

# 로컬 개발 (PM2 필요)
pm2 start ecosystem.config.cjs

# 배포
npm run deploy
```

---

## 3. 프로젝트 구조

```
webapp/
├── src/
│   ├── index.tsx               ← 메인 진입점 (라우트 등록, 인증 미들웨어)
│   ├── middleware/
│   │   └── auth.ts             ← JWT_SECRET, 인증 미들웨어
│   ├── utils/
│   │   └── auth.ts             ← verifyToken, hashPassword
│   └── routes/
│       ├── admin.ts            ← 관리자 전용 API (병원·계정·휴일·예산설정 등)
│       ├── auth.ts             ← 로그인/로그아웃/세션
│       ├── card_expenses.ts    ← 법인카드 지출 관리
│       ├── ceo-dashboard.ts    ← 경영 대시보드 집계
│       ├── dashboard.ts        ← 영양사 월별 대시보드
│       ├── executive.ts        ← 운영진 대시보드
│       ├── meals.ts            ← 식수 입력
│       ├── orders.ts           ← 발주 입력
│       ├── schedule.ts         ← 스케줄 관리 (직원·휴가·외부인력 등)
│       ├── settings.ts         ← 마감 요청·세션·알림
│       ├── transaction.ts      ← 거래명세서 분석 (AI 포함)
│       └── vendors.ts          ← 업체 관리
│
├── public/
│   └── static/
│       ├── app.js              ← 프론트엔드 전체 (~34,800줄, SPA)
│       ├── executive.js        ← 운영진/경영 대시보드 전용 JS
│       ├── styles.css          ← 전체 CSS
│       ├── style.css           ← 추가 CSS (거래명세서 등)
│       ├── jspdf.umd.min.js    ← PDF 출력 라이브러리 (로컬)
│       ├── NanumGothic.ttf     ← 한글 폰트 (PDF용)
│       ├── NanumGothicBold.ttf ← 한글 폰트 볼드 (PDF용)
│       └── NanumGothic.b64.txt ← Base64 인코딩 폰트 (PDF 임베드용)
│
├── migrations/                 ← D1 마이그레이션 SQL (0001~0047)
├── wrangler.jsonc              ← Cloudflare 설정
├── package.json
├── vite.config.ts
├── ecosystem.config.cjs        ← PM2 설정 (로컬 개발용)
└── tsconfig.json
```

### ⚠️ 중요: app.js 구조

`app.js`는 단일 파일 SPA로 **약 34,800줄**입니다.  
빌드 도구 없이 직접 편집하며, 주요 렌더 함수 위치:

| 함수명 | 시작 라인 | 역할 |
|--------|-----------|------|
| `renderDashboard()` | 669 | 영양사 월별 대시보드 |
| `renderOrders()` | 2072 | 발주 입력 화면 |
| `renderMeals()` | 6767 | 식수 입력 화면 |
| `renderMealsContent()` | 6802 | 식수 내용 렌더링 |
| `renderSettings()` | 8855 | 마감 요청 화면 |
| `renderAdminDashboard()` | 10525 | 관리자 전체 현황 |
| `renderSchedule()` | 11885 | 스케줄 관리 화면 |
| `renderScheduleTab()` | 11951 | 스케줄 탭 전환 |
| `renderCardExpenseModal()` | 24966 | 법인카드 입력 모달 |
| `renderCeoDashboard()` | 25924 | 경영 대시보드 |
| `renderTransactionAnalysis()` | 27245 | 거래명세서 분석 |

---

## 4. 디자인 시스템 (색상 & UI 규칙)

### 🎨 메인 컬러 팔레트 (진녹색 계열)

```css
/* 사이드바 그라디언트 */
--sidebar-dark:    #1a4731   /* 가장 어두운 녹 (사이드바 상단) */
--sidebar-mid:     #15502b   /* 중간 녹 (사이드바 중간) */
--sidebar-deep:    #123d22   /* 깊은 녹 (사이드바 하단) */

/* 주요 액션 컬러 */
--green-base:      #166534   /* 기본 녹 (테이블 헤더, 버튼) */
--green-medium:    #15803d   /* 중간 녹 (호버, 그라디언트 끝) */
--green-light:     #16a34a   /* 밝은 녹 (버튼, 활성 탭, 포커스) */
--green-bright:    #22c55e   /* 가장 밝은 녹 (성공 버튼) */
```

### 📊 발주 입력 테이블 — 업체 세금 유형별 색상

| 세금 유형 | 배경색 | 글자색 | 레이블 |
|-----------|--------|--------|--------|
| `taxable` (과세) | `#dcfce7` | `#166534` | 과세 |
| `exempt` (면세) | `#fffbeb` | `#92400e` | 면세 |
| `vat` (VAT 별도) | `#f9fafb` | `#6b7280` | VAT |
| `mixed_total` (혼합합계) | `#eff6ff` | `#1d4ed8` | 합계 |
| `card` (법인카드) | `#f3e8ff` | `#7c3aed` | 카드 |

### 🗂️ 발주 업체 카테고리별 뱃지 색상

```javascript
organic:'bg-green-400'   // 유기농
delivery:'bg-purple-400' // 납품
market:'bg-orange-400'   // 시장구매
event:'bg-pink-400'      // 이벤트
card:'bg-gray-400'       // 법인카드
```

### 🏷️ 상태 뱃지 색상

| 클래스 | 배경 | 글자 | 용도 |
|--------|------|------|------|
| `badge-green` | `#dcfce7` | `#166534` | 정상/완료 |
| `badge-yellow` | `#fef9c3` | `#a16207` | 주의/경고 |
| `badge-red` | `#fee2e2` | `#dc2626` | 오류/초과 |
| `badge-blue` | `#dcfce7` | `#166534` | 정보 (현재 녹과 동일) |
| `badge-gray` | `#f1f5f9` | `#64748b` | 비활성 |
| `badge-purple` | `#f3e8ff` | `#7c3aed` | 법인카드 |

### 📅 달력/테이블 행 배경

| 상태 | 배경색 | 용도 |
|------|--------|------|
| 주말 행 | `#fffbeb` | 토·일요일 |
| 공휴일 행 | `#fef2f2` | 법정 공휴일 |
| 주중 | 흰색 | 일반 평일 |
| 오늘 | `#eff6ff` (파란빛) | 현재 날짜 강조 |
| 당월 | `#f0fdf4` (녹빛) | 선택된 달 |

### 🔴 진행률 바 색상

```css
.progress-green  → linear-gradient(#16a34a → #15803d)  /* 정상 범위 */
.progress-yellow → linear-gradient(#f59e0b → #d97706)  /* 주의 범위 */
.progress-red    → linear-gradient(#ef4444 → #dc2626)  /* 초과/위험 */
.progress-blue   → linear-gradient(#166534 → #15803d)  /* 기타 */
```

### 🖥️ 레이아웃 구조

```
┌────────────────────────────────────────────────────┐
│  사이드바 (240px, 진녹색 그라디언트)                  │
│  ┌──────────────────────────────────────────────┐  │
│  │ 로고 + 병원명                                  │  │
│  │ 메뉴 섹션 제목 (대문자, 흰색 35% 투명)          │  │
│  │ 메뉴 항목 (아이콘 + 라벨)                      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  메인 콘텐츠 (flex-1, #f8fafc 배경)                 │
│  ┌──────────────────────────────────────────────┐  │
│  │ 상단 헤더 (페이지 제목 + 월 선택 + 사용자 정보) │  │
│  │ 콘텐츠 영역 (id="pageContent")                │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  모바일 하단 네비게이션 (768px 이하)                  │
└────────────────────────────────────────────────────┘
```

---

## 5. 사용자 역할 체계

| role 값 | 명칭 | 접근 가능 화면 | 비고 |
|---------|------|--------------|------|
| `hospital` | 영양사 | 대시보드, 발주 입력, 식수 입력, 스케줄, 마감 요청, 지출결의서 | 마감 승인된 달 → 읽기전용 |
| `admin` | 관리자 | 전체 현황, 병원 관리, 공휴일, 직원 관리, 비교 분석, 보고서, 경영 대시보드, 거래명세서 분석 | 마감 승인 권한, 항상 편집 가능 |
| `executive` | 운영진 | executive.js 전용 화면 (운영진 대시보드) | 로그인 시 `/executive`로 자동 리다이렉트 |
| `ceo` | 경영진 | 경영 대시보드 | - |

### 인증 흐름

```
로그인 → JWT 발급 → localStorage 저장
→ 모든 /api/* 요청에 Authorization: Bearer {token} 헤더
→ executive 역할은 /executive 페이지로 리다이렉트
→ admin 역할은 관리자 메뉴 표시
→ hospital 역할은 영양사 메뉴 표시
```

### 마감(읽기전용) 처리

```javascript
// App.lockedMonths = ["2026-01", "2025-12", ...]  ← 마감 승인된 달
// isReadOnly(year, month) → admin은 항상 false, 영양사는 lockedMonths 체크
// 마감된 달에서 저장 시도 → "⛔ 마감 완료된 달은 수정할 수 없습니다." 토스트
// 화면 상단에 readOnlyBanner() 노란 배너 표시
```

---

## 6. 메뉴 구조

### 영양사 메뉴 (`getHospitalMenus()`)

| 순서 | id | 아이콘 | 라벨 | 섹션 |
|------|-----|--------|------|------|
| 1 | `dashboard` | fa-chart-line | 월별 대시보드 | 현황 |
| 2 | `orders` | fa-clipboard-list | 발주 입력 | - |
| 3 | `meals` | fa-utensils | 식수 입력 | - |
| 4 | `schedule` | fa-calendar-alt | 스케줄 관리 | - |
| 5 | `settings` | fa-flag-checkered | 마감 요청 | 관리 |
| 6 | `expense-doc` | fa-file-invoice-dollar | 지출결의서 | - |

### 관리자 메뉴 (`getAdminMenus()`)

| 순서 | id | 아이콘 | 라벨 | 섹션 |
|------|-----|--------|------|------|
| 1 | `admin` | fa-th-large | 전체 현황 | 관리자 |
| 2 | `hospital-manage` | fa-hospital | 병원 관리 | - |
| 3 | `holiday-manage` | fa-calendar-times | 공휴일 관리 | - |
| 4 | `staff-manage` | fa-users-cog | 직원 관리 | 인사 |
| 5 | `analysis` | fa-chart-bar | 비교 분석 | 분석 |
| 6 | `report` | fa-file-pdf | 보고서 출력 | - |
| 7 | `ceo-dashboard` | fa-crown | 경영 대시보드 | 경영 |
| 8 | `transaction-analysis` | fa-file-invoice | 거래명세서 분석 | 데이터 분석 |

> 병원 관리(`hospital-manage`) 메뉴에는 **마감요청 배지(빨강)** + **이슈 알림 배지(주황)** 두 개 표시

---

## 7. 화면별 기능 상세

### 7-1. 월별 대시보드 (`renderDashboard`, L.669)

**주요 표시 항목:**
- 예산 현황 카드: 총 예산, 사용액, 잔여, 소진율
- 식단가 현황: 전체, 직원식 제외, 소모품 제외
- 진행률 바: 일별/주별/월별
- AI 경고: 발주 적정성, 예산 소진 예상일, 이상 발주
- 업체별 예산 현황 테이블
- 환자군별 식수·식단가 분석
- 가중평균 식단가

**핵심 변수 (app.js L.775~781):**
```javascript
const mealPrice         // 실제 식단가 (총 사용액 / 총 식수)
const mealPriceTotal    // API에서 계산된 전체 식단가
const mealPriceNoStaff  // 직원식 제외 식단가
const mealPriceNoSupply // 소모품 제외 식단가
const targetMealPrice   // 목표 식단가 (settings.meal_price)
const mpOver            // 목표 초과 여부 (boolean)
```

**⚠️ 주의: 식단가 계산 원칙**
- **전체 식단가** = 식재료비(직원식·소모품 포함) / 전체 식수
- **직원식 제외** = 식재료비(소모품 제외X, 직원식만 제외) / 직원식 제외 식수
- **소모품 제외** = 식재료비에서 소모품 금액 차감 / 전체 식수
- 각 항목은 **서로 다른 분모/분자**를 사용해야 함 → 동일하게 표시되면 버그

---

### 7-2. 발주 입력 (`renderOrders`, L.2072)

**핵심 기능:**
- 날짜별 업체별 발주 금액 입력 (월간 테이블)
- 세금 유형별 컬럼 (과세/면세/VAT/혼합합계)
- 법인카드 입력 (별도 모달, 보라색 구분)
- 카테고리별 발주 (식재료 카테고리 분류)
- 주간 소계 행, 월 합계 행
- 전체보기 모달 (`monthAllOrdersModal`)

**업체 컬럼 색상 (subType 기준):**
```javascript
subColor = {
  taxable:     '#16a34a',  // 과세 → 녹색
  exempt:      '#d97706',  // 면세 → 주황
  vat:         '#6b7280',  // VAT → 회색
  mixed_total: '#1d4ed8',  // 혼합합계 → 파란색
  card:        '#7c3aed'   // 법인카드 → 보라색
}
subBg = {
  taxable:     '#f0fdf4',
  exempt:      '#fffbeb',
  vat:         '#f9fafb',
  mixed_total: '#eff6ff',
  card:        '#f3e8ff'
}
```

**합계 계산 규칙:**
- `rowTotal` = taxable + exempt + mixed_total (VAT 별도 처리)
- 법인카드는 별도 집계 후 표시 (중복 포함 주의)
- `grandTotal` = 전체 월 합계

---

### 7-3. 식수 입력 (`renderMeals`, L.6767)

**주요 기능:**
- 날짜별 환자군·식이 분류별 식수 입력
- 직원식 분리 입력
- 월별 대시보드와 연동 (실시간 반영)
- 비급여 항목 중 식단가 체크된 항목만 계산

**⚠️ 계산 원칙:**
- 직원식 제외 분모 = 전체 식수 - 직원식 수
- 비급여 식수 = `include_in_meal_price = true`인 항목만 분자·분모에 포함

---

### 7-4. 스케줄 관리 (`renderSchedule`, L.11885)

**탭 구성:**
- 직원 목록 / 근무 일정 / 휴가 관리 / 외부 인력 / 파견 일정
- 월별 근무표 캘린더 뷰

**연동 항목:**
- 공휴일 (holidays 테이블 연동)
- 직원 연차 자동 계산
- 마감 완료 달 → 읽기전용

---

### 7-5. 마감 요청 (`renderSettings`, L.8855)

**흐름:**
```
영양사: 마감 요청 버튼 클릭
  → monthly_closings 테이블에 요청 기록
  → 관리자 병원 관리 메뉴 배지(빨강) 표시

관리자: 병원 관리 → 마감 요청 탭에서 확인
  → 승인 클릭
  → App.lockedMonths 업데이트
  → 영양사 화면 읽기전용 전환 (폴링으로 자동 감지)
  → 다음 달로 자동 이동
```

---

### 7-6. 지출결의서 (`expense-doc`)

**지출 유형 분류:**
```javascript
['delivery', 'market', 'event', 'card', 'supply', 'etc']
// delivery: 납품업체, market: 현장구매, event: 이벤트
// card: 법인카드, supply: 소모품, etc: 기타
```

**⚠️ 중요:**
- 지출결의서와 발주 입력이 같은 항목을 **이중 계산**하지 않도록 주의
- 법인카드는 card_expenses 테이블 기준으로만 집계
- 운영진·관리자 대시보드에 정상 반영 여부 항상 확인

---

### 7-7. 관리자 전체 현황 (`renderAdminDashboard`, L.10525)

- 전체 병원 현황 요약
- 병원별 KPI 카드
- 병원 유형·운영 유형 필터

---

### 7-8. 경영 대시보드 (`renderCeoDashboard`, L.25924)

**필터:**
- 병원 유형 / 운영 유형 / 병상 규모 조합

**표시 항목:**
- KPI 수치, AI 경고, 환자군별 현황
- 그래프 (Chart.js)
- PDF/PPT 저장 (한글 폰트 NanumGothic 필요)

---

### 7-9. 거래명세서 분석 (`renderTransactionAnalysis`, L.27245)

- 엑셀/PDF 업로드 → AI 자동 분석
- 컬럼 매핑, 카테고리 자동 분류
- 월별 추이, 단가·단위 정규화
- TOP12·TOP10·TOP1 품목 분석
- 보고서 출력 (PPT/PDF/Excel)

---

## 8. 백엔드 API 구조

### 인증
```
POST /api/auth/login          ← 로그인 (JWT 발급)
POST /api/auth/logout
GET  /api/auth/me
```

### 대시보드
```
GET  /api/dashboard           ← 월별 집계 (mealPrice, mealPriceNoStaff, mealPriceNoSupply 등)
```

### 발주
```
GET  /api/orders              ← 월별 발주 데이터 조회
POST /api/orders              ← 발주 저장
GET  /api/orders/summary      ← 월 합계
DELETE /api/orders/:id
```

### 식수
```
GET  /api/meals               ← 월별 식수 조회
POST /api/meals               ← 식수 저장
DELETE /api/meals/custom-fields/:id
```

### 업체
```
GET    /api/vendors           ← 업체 목록
POST   /api/vendors
DELETE /api/vendors/:id
```

### 스케줄
```
GET/POST/DELETE /api/schedule/employees
GET/POST/DELETE /api/schedule/shifts
GET/POST/DELETE /api/schedule/positions
GET/POST/DELETE /api/schedule/holidays
GET/POST/DELETE /api/schedule/external-workers
GET/POST/DELETE /api/schedule/:employeeId/:workDate
GET/POST        /api/schedule/employees/:id/leaves
GET/POST/DELETE /api/schedule/off-grants/substitute/:id
DELETE          /api/schedule/clear-month/:year/:month
```

### 설정/마감
```
GET/POST /api/settings        ← 예산 설정
POST     /api/settings/close-request
POST     /api/settings/session/heartbeat
```

### 법인카드
```
GET/POST/DELETE /api/card-expenses
GET/POST/DELETE /api/card-expenses/direct/:id
```

### 관리자 전용 (`/api/admin/`)
```
GET/POST/PUT/DELETE /api/admin/hospitals/:id
GET/POST/PUT/DELETE /api/admin/hospitals/:id/vendors/:vid
GET/POST/DELETE     /api/admin/holidays/:date
GET/POST/PUT/DELETE /api/admin/hospitals/:id/accounts/:uid
GET/POST/PUT/DELETE /api/admin/hospitals/:id/executive-accounts/:uid
GET/POST/PUT/DELETE /api/admin/hospitals/:id/diet-categories/:catId
```

### 거래명세서
```
POST   /api/transaction/upload
GET    /api/transaction/files
DELETE /api/transaction/files/:fileId
POST   /api/transaction/analyze
DELETE /api/transaction/vendor-templates/:name
DELETE /api/transaction/invoice/file/:file_id
DELETE /api/transaction/invoice-vendors/:id
```

---

## 9. 데이터베이스 구조

### 마이그레이션 히스토리 (migrations/ 폴더)

| 파일 | 내용 |
|------|------|
| `0001_initial.sql` | 기본 테이블 (hospitals, users, vendors, monthly_settings, daily_orders, daily_meals, employees, daily_schedules) |
| `0002_seed.sql` | 초기 데이터 |
| `0003_hospital_info.sql` | 병원 정보 테이블 |
| `0004_specialty.sql` | 진료과 |
| `0005~0008` | 일별 이슈, 계정, 세션 |
| `0009_meal_custom_fields.sql` | 식수 커스텀 필드 |
| `0011_patient_categories.sql` | **환자군 분류** (핵심) |
| `0012_category_daily_meal_count.sql` | 환자군별 일별 식수 |
| `0015_category_diet_price_formula.sql` | 식단가 계산 공식 |
| `0016_card_expenses.sql` | **법인카드 지출** |
| `0017_order_inspection.sql` | 발주 검수 |
| `0020_ceo_dashboard.sql` | 경영 대시보드 집계 |
| `0021_expense_type.sql` | 지출 유형 |
| `0022_transaction_statements.sql` | **거래명세서 분석** |
| `0024_diet_categories.sql` | 식이 카테고리 |
| `0025_diet_structure_v2.sql` | 식이 구조 v2 |
| `0026_diet_v3_patient_group_structure.sql` | 환자군 구조 v3 |
| `0027_executive_role.sql` | **운영진 역할** |
| `0029_invoice_category_analysis.sql` | 청구서 카테고리 분석 |
| `0030_staff_diet_types.sql` | 직원식 유형 |
| `0031~0032` | 청구서 업체 연동 |
| `0033_invoice_period_mode.sql` | 청구서 기간 모드 |
| `0034~0035` | 식재료 자동 원산지, 업체별 단가 |
| `0036_ref_meal_price.sql` | **기준 식단가** |
| `0037_order_multiday_settings.sql` | 다중일 발주 설정 |
| `0038_order_input_source.sql` | 발주 입력 소스 |
| `0039_schedule_module_v1.sql` | **스케줄 모듈 v1** |
| `0040_monthly_off_grants.sql` | 월별 휴가 허가 |
| `0041_fix_positions.sql` | 직위 수정 |
| `0042_labor_cost_tables.sql` | 인건비 테이블 |
| `0043_schedule_enhancements.sql` | 스케줄 개선 |
| `0044_labor_cost_v2.sql` | 인건비 v2 |
| `0045_dispatch_unique.sql` | 파견 유니크 제약 |
| `0046_external_workers.sql` | 외부 인력 |
| `0047_leave_carryover_allowance.sql` | **연차 이월 허용** |

### 주요 테이블 목록 (현재 운영 중)

```sql
-- 병원/사용자
hospitals, users, hospital_sessions, hospital_info
hospital_work_settings, hospital_meal_price_settings
hospital_patient_categories  -- 환자군 설정

-- 예산/발주
monthly_settings             -- 월별 예산 설정
daily_orders                 -- 일별 발주 입력
order_inspections            -- 발주 검수
order_multiday_settings      -- 다중일 발주 설정
card_expenses                -- 법인카드 지출

-- 식수
daily_meals                  -- 일별 식수 입력
meal_custom_fields           -- 커스텀 필드 정의
diet_categories              -- 식이 카테고리
diet_category_presets        -- 식이 프리셋

-- 업체
vendors                      -- 업체 목록
ingredient_prices            -- 식재료 단가
category_budgets             -- 카테고리별 예산

-- 스케줄
employees                    -- 직원 목록 (annual_leave_total: 15일 기본)
daily_schedules              -- 일별 근무표
employee_leaves              -- 직원 휴가
employee_leave_history       -- 연차 이력
schedule_shifts              -- 근무 조
schedule_min_staff           -- 최소 인원
substitute_off_days          -- 대체 휴일
dispatch_schedules           -- 파견 일정
external_workers             -- 외부 인력
external_schedules           -- 외부 인력 일정

-- 마감
monthly_closings             -- 마감 요청/승인

-- 거래명세서
transaction_documents        -- 업로드 문서
transaction_files            -- 파일 목록
transaction_items            -- 파싱된 항목
transaction_item_categories  -- 카테고리 분류
transaction_vendor_templates -- 업체 템플릿
transaction_ai_analysis      -- AI 분석 결과
hospital_invoice_vendors     -- 청구서 업체
invoice_supplier_classifications -- 공급업체 분류

-- 기타
holidays                     -- 공휴일
notifications                -- 알림
monthly_work_summary         -- 월별 근무 요약
labor_cost_settings          -- 인건비 설정
close_month_requests         -- 마감 요청
food_waste_records           -- 음식물 쓰레기
inspection_issues            -- 검수 이슈
```

---

## 10. 핵심 계산 로직

### 식단가 계산 (3가지 구분)

```javascript
// [1] 전체 식단가 (mealPriceTotal)
= (전체 발주 사용액) / (전체 식수)

// [2] 직원식 제외 식단가 (mealPriceNoStaff)
= (전체 발주 사용액) / (전체 식수 - 직원식 수)
// ⚠️ 직원식 금액은 분자에서 제외하지 않음

// [3] 소모품 제외 식단가 (mealPriceNoSupply)
= (전체 발주 사용액 - 소모품 금액) / (전체 식수)
// ⚠️ 분모는 전체 식수 그대로, 분자에서만 소모품 제외
```

### 예산 소진율 계산

```javascript
// 일별 소진율 = 오늘까지 사용액 / 오늘까지 예산
// 주별 소진율 = 이번주 사용액 / 이번주 예산
// 월별 소진율 = 월 사용액 / 월 예산
// → 각각 100% 초과 가능 (초과 시 빨간색 표시)
```

### 업체별 목표금액 배분

```javascript
// 예산 설정 → 업체별 목표금액 합산 = 식재료 기본 예산
// 소모품·이벤트·법인카드는 별도 항목으로 분리
// 5개 항목: 식재료, 이벤트, 소모품, 법인카드, 기타
// ⚠️ 5개 항목이 중복 합산되지 않도록 주의
```

### 연차 계산 (스케줄)

```javascript
// 기본 연차: employees.annual_leave_total (기본값 15일)
// 이월 허용 여부: leave_carryover_allowance 마이그레이션(0047)
// 사용: employee_leaves 테이블
// 잔여 = 총 연차 + 이월 - 사용
```

---

## 11. 기능 개발 히스토리

> 마이그레이션 순서를 기준으로 개발 순서를 추적할 수 있음

| 단계 | 주요 기능 추가 |
|------|----------------|
| 초기 (0001~0010) | 병원·사용자·업체·발주·식수 기본 기능 |
| 환자군 (0011~0015) | 환자군 분류, 일별 식수, 식단가 공식 |
| 지출 관리 (0016~0021) | 법인카드, 발주 검수, 경영 대시보드, 지출 유형 |
| 거래명세서 (0022~0023) | 거래명세서 업로드·분석 |
| 식이 구조 (0024~0026) | 식이 카테고리 v1→v3 전면 개편 |
| 운영진 (0027~0029) | 운영진 역할, 청구서 카테고리 분석 |
| 식재료 자동화 (0030~0035) | 직원식 유형, 청구서 업체 연동, 자동 원산지, 단가 |
| 기준 식단가 (0036) | 기준 식단가 참조 테이블 |
| 발주 개선 (0037~0038) | 다중일 발주, 입력 소스 구분 |
| **스케줄 모듈** (0039~0047) | 전체 스케줄 시스템 (직원·휴가·파견·외부인력·인건비·연차) |

---

## 12. 알려진 이슈 & 수정 필요 항목

> 출처: `개발자 요청 문구(예산 급식 운영 부분-아미나).docx`

### 🔴 우선순위 1 (즉시 수정)

#### 월별 대시보드
- [ ] **목표 금액 2배 오류**: 목표금액이 2배로 표시되는 버그
- [ ] **직원식/소모품 제외 식단가 동일 표시**: 3가지 식단가(전체·직원식제외·소모품제외)가 같은 값으로 나오는 버그 → 계산 로직 분리 필요
- [ ] **진행률 100% 초과**: 일/주/월 진행률이 100%를 넘어도 100%로 cap 처리 누락
- [ ] **목표·현재 식단가 혼합 계산**: 분자/분모 혼용 오류

#### 발주 입력
- [ ] **날짜별 재조회 시 값 미유지**: 발주 입력 후 다른 달 이동 → 돌아오면 값 사라지는 현상
- [ ] **+/- 처리 오류**: 차감·변동 금액의 부호 처리 버그
- [ ] **소모품·이벤트·법인카드 금액 미반영**: 대시보드에 실시간 반영 안 됨
- [ ] **일/주/월 합계 불일치**: 업체별 입력 총합과 합계 행이 다른 경우

#### 식수 입력
- [ ] **환자군·식이 분류 노출 문제**: 중복 또는 미표시
- [ ] **직원식 제외 분모 오류**: 직원식 제외 시 분모에서 정확히 차감 안 됨

#### 예산설정
- [ ] **5개 항목 중복 계산**: 식재료+이벤트+소모품+법인카드+기타가 중복 합산되는 버그

### 🟡 우선순위 2 (다음 수정)

#### 운영진/경영 대시보드
- [ ] **필터 조합 시 병원 소실**: 병원 유형·운영 유형·병상 규모 조합 필터 적용 시 일부 병원 누락
- [ ] **KPI·AI 경고 수치 불일치**: 대시보드 KPI와 AI 경고 숫자가 다르게 표시
- [ ] **그래프 라벨 잘림**: Chart.js 그래프에서 라벨·범례가 잘리는 현상
- [ ] **PDF/PPT 저장 문제**: 여백·텍스트 정렬·차트 겹침 오류

#### 마감 요청
- [ ] **승인 후 읽기전용 전환 타이밍**: 폴링 지연으로 즉시 반영 안 되는 경우
- [ ] **수정·조회 권한 분리**: 마감 후 조회는 되지만 일부 수정 가능한 버그

### 🟢 우선순위 3 (개선 사항)

#### 거래명세서 분석
- [ ] **TOP12·TOP10·TOP1 의미 검증**: 각 분석 결과의 기준 명확화
- [ ] **비정상 단가 감지**: 이상 단가 자동 플래그 기능
- [ ] **한글 깨짐 재발**: PDF 출력 시 NanumGothic 폰트 로드 실패 케이스

#### 병원 관리
- [ ] **환자군 삭제 후 복구 오류**: 삭제된 환자군 복구 시 데이터 불일치
- [ ] **목표 식단가 고정 미유지**: 저장 후 재입력 시 초기화되는 현상

---

## 13. 개발 환경 설정

### 요구 사항
- Node.js 18+
- npm
- PM2 (`npm install -g pm2`)
- Wrangler (`npm install` 시 devDependencies에 포함)

### 최초 설정

```bash
cd /home/user/webapp

# 의존성 설치
npm install

# D1 로컬 마이그레이션 적용
npx wrangler d1 migrations apply hospital-meal-production --local

# 빌드
npm run build

# PM2로 실행
pm2 start ecosystem.config.cjs

# 접속 확인
curl http://localhost:3000
```

### ecosystem.config.cjs 예시

```javascript
module.exports = {
  apps: [{
    name: 'webapp',
    script: 'npx',
    args: 'wrangler pages dev dist --d1=hospital-meal-production --local --ip 0.0.0.0 --port 3000',
    watch: false,
    instances: 1,
    exec_mode: 'fork'
  }]
}
```

### 로컬 개발 시 주의

1. **app.js 수정 후** → `npm run build` 필수 (빌드 스크립트가 dist/에 복사)
2. **새 마이그레이션 추가 시** → `npx wrangler d1 migrations apply hospital-meal-production --local`
3. **PM2 재시작** → `pm2 restart webapp` (포트 충돌 시 `fuser -k 3000/tcp`)

---

## 14. 배포 방법

```bash
# 1. Cloudflare API 키 설정 (최초 1회)
# Deploy 탭에서 CLOUDFLARE_API_TOKEN 설정

# 2. 빌드 + 배포
npm run deploy
# = npm run build + wrangler pages deploy

# 3. 프로덕션 D1 마이그레이션 (새 마이그레이션 추가 시)
npx wrangler d1 migrations apply hospital-meal-production

# 4. 배포 확인
npx wrangler whoami
```

**Cloudflare 설정 정보:**
- Project Name: `hospital-meal-budget`
- D1 Database: `hospital-meal-production`
- D1 ID: `8cd39977b63bb3122ba4bce948af09ffc1cd80e74253123a1208272811ea0b15`

---

## 15. 주의사항 & 개발 원칙

### ⚠️ 절대 주의사항

1. **app.js는 단일 파일** (~34,800줄) → 함수 추가 시 파일 끝 근처에 추가, 기존 함수 수정 시 라인 번호 확인 필수
2. **build 후 테스트** → `public/static/app.js` 수정 후 반드시 `npm run build` 실행
3. **D1은 SQLite 문법** → `ON CONFLICT`, `INSERT OR IGNORE` 등 SQLite 전용 문법 사용
4. **법인카드 이중집계 방지** → 발주 입력과 card_expenses가 동일 금액을 두 곳에서 집계하지 않도록
5. **마감 처리** → 마감된 달 데이터 수정 API 호출 시 반드시 `isReadOnly` 체크

### 개발 원칙

1. **전체 흐름 우선**: 병원관리 → 식수 입력 → 발주 입력 → 검수·지출 → 월별·운영진 대시보드 → 보고서 → 마감 후 읽기전용 흐름에서 저장·계산·집계·출력이 일관되어야 함
2. **화면 간 연동 확인**: 한 화면에서 저장 → 다른 화면에서 즉시 반영되는지 확인
3. **월/일/카테고리별 집계 일관성**: 일 합계의 합 = 월 합계, 카테고리 합계의 합 = 전체 합계
4. **PDF 한글 폰트**: NanumGothic.b64.txt 사용, 로드 실패 시 영문 폴백 필요
5. **모바일 대응**: 768px 이하 모바일 하단 네비게이션 동작 유지

### 코드 스타일

```javascript
// 통화 포맷
const fmt = (n) => Math.round(n).toLocaleString()
const fmtMan = (n) => Math.round(n / 10000).toLocaleString() + '만'

// API 호출 패턴
const data = await api('GET', '/api/dashboard?year=2026&month=4')
const result = await api('POST', '/api/orders', { date: '2026-04-01', amount: 50000 })

// 토스트 알림
showToast('저장되었습니다.', 'success')
showToast('오류가 발생했습니다.', 'error')

// 읽기전용 체크 패턴
if (isReadOnly(year, month)) {
  showToast('⛔ 마감 완료된 달은 수정할 수 없습니다.', 'error')
  return
}
```

---

## 📞 추가 문의

이 문서에서 다루지 않은 세부 사항은 다음을 참고:
- `src/routes/*.ts` — API 엔드포인트 상세 구현
- `migrations/*.sql` — 테이블 스키마 상세
- `public/static/executive.js` — 운영진 대시보드 전용 로직
- 기존 개발 채팅 히스토리 (Genspark AI)

---

*이 문서는 시스템 변경 시 함께 업데이트해야 합니다.*
