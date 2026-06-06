# 병원급식 예산관리 시스템

## 프로젝트 개요
- **이름**: 병원급식 예산관리 시스템 (Hospital Meal Budget Management)
- **목표**: 병원 급식 발주, 예산, 식단가를 통합 관리하는 웹 애플리케이션
- **주요 기능**: 거래명세서 분석, 발주 관리, 예산 추적, 카테고리별 식단가 비교

## 서비스 URL
- **로컬 개발**: http://localhost:3000
- **관리자 계정**: admin / admin123
- **일반 사용자**: amina / hospital1234

## 주요 기능

### ✅ 완료된 기능
1. **거래명세서 분석** (메뉴: 거래명세서)
   - Excel 파일 업로드 및 파싱 (삼성웰스토리 포맷 지원)
   - 분류별 분석: 가공식품, 농산물류, 수산/건어물류, 육류
   - 분류별 금액 비중 도넛 차트
   - 품목별 금액 상세 테이블 (검색/필터)
   - **월별 사용률 분석**: 분류별 순위, 수량 기준 TOP 8 품목
   - **엑셀 다운로드**: 분류별요약/품목상세/TOP5 3개 시트
   - 월별 추이 분석 (2개월 이상 데이터 축적 시 자동 활성화)
   - 전월 대비 분류별 증감 비교 카드

2. **발주 관리**
   - 일별/월별 발주 입력 및 관리
   - 업체별 발주 현황

3. **예산 분석**
   - 카테고리별 예산 목표 대비 실적
   - 식단가 계산 (환자군별)

### ⏳ 추가 가능 기능 (추후 개발)
- 다중 월 데이터 업로드 후 월별 트렌드 자동 차트
- 여러 업체 비교 분석
- PDF 형태 보고서 출력

## 데이터 아키텍처

### 데이터 모델
- `transaction_files`: 업로드된 거래명세서 파일 메타정보
- `transaction_documents`: 거래 문서 (날짜, 금액 합계)
- `transaction_items`: 품목별 상세 (코드, 명칭, 규격, 수량, 단가, 금액, 분류)
- `invoice_supplier_classifications`: 업체별 분류 목록

### 핵심 필드
- `supplier_category`: 업체 명세서의 분류명 (가공식품, 농산물류 등)
- `item_code`: 품목코드 (예: 1000013135)
- `spec`: 규격 (원산지, 용량, 포장 등)

### 저장소
- **DB**: Cloudflare D1 (로컬: SQLite via wrangler --local)
- **인증**: JWT (24시간 만료)

## 거래명세서 분석 결과 (2026년 3월 삼성웰스토리)

| 분류 | 품목수 | 합계금액 | 비율 |
|------|------:|--------:|-----:|
| 수산/건어물류 | 4개 | 720,080원 | 57.7% |
| 농산물류 | 26개 | 344,343원 | 27.6% |
| 가공식품 | 8개 | 104,710원 | 8.4% |
| 육류 | 4개 | 78,710원 | 6.3% |
| **합계** | **42개** | **1,247,843원** | **100%** |

### 가공식품 8개 품목 (사용자 지정)
| 품목코드 | 품목명 | 금액 |
|---------|--------|-----:|
| 1000729563 | 생수,풀무원샘물 | 27,200원 |
| 1000755086 | 옛날호두과자 | 24,380원 |
| 1000760589 | 담백굵은면두부(VB) | 16,040원 |
| 1000152538 | 판두부(VB) | 11,340원 |
| 1000717077 | 고구마샐러드골드 | 5,980원 |
| 1000740804 | 감자샐러드A | 5,960원 |
| 1000013135 | 호밀빵 | 4,220원 |
| 1000013144 | 플레인모닝롤빵 | 2,560원 |

## API 엔드포인트

### 거래명세서 분석
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/transaction/invoice/category-summary` | 분류별 요약 (vendor_name, year, month) |
| GET | `/api/transaction/invoice/monthly-trend` | 월별 추이 (vendor_name, months) |
| GET | `/api/transaction/invoice/items` | 품목 목록 (vendor_name, year, month, category) |
| GET | `/api/transaction/invoice/vendors` | 업체 목록 |
| POST | `/api/transaction/upload` | 파싱된 명세서 업로드 |

### 인증
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 로그인 (username, password) |

## 개발 환경 설정

```bash
# 의존성 설치
npm install

# DB 마이그레이션 (로컬)
npm run db:migrate:local

# 개발 서버 시작
npm run build
pm2 start ecosystem.config.cjs

# 로그 확인
pm2 logs hospital-meal --nostream
```

## 근무 스케줄 — OT(연장근무) 입력 [A단계]
- **OT 입력 모달**: 스케줄 화면 상단 `근무조 · OT` 그룹의 **OT 버튼** 클릭 → 선택한 셀(단일)에 대해 OT 입력 모달 표시
  - 모달 내용: 날짜 / 직원명 / 현재 근무조 / OT 시간 선택(1H·2H·3H·4H 프리셋 + 직접입력) / 비고 / 저장 / 취소
  - 저장: 기존 `POST /api/schedule/save` 사용, `overtimeHours` → `daily_schedules.overtime_hours` 저장 (기존 근무조·비고 보존)
- **셀 표시**: 근무조 코드 아래에 `OT 2H` 배지 표시 (반차 표시와 동일 방식)
- **우측 OT 컬럼**: 직원별 월 OT 총 시간(`{n}H`) 표시 + 마우스 오버 시 날짜별 OT 내역 툴팁(예: `05/15 OT 2H … 총 2H`)
- **DB 구조 변경 없음**: 기존 컬럼(`is_overtime`, `overtime_hours`, `note`)만 사용
- **반영 화면**: 스케줄 관리 / labor-cost-report(otHours) / 병원장 staff-labor(SUMMARY·DETAIL otHours)
- **영향 없음**: 식단가 엔진 / 외부인력 엔진 / daily_orders / daily_meals (검증 완료)
- **다음 단계**: B단계(OT/야간/휴일 수당 활성화 정책) · C단계(공휴일/대체휴일 세분화) 별도 진행 예정

## 근무 스케줄 — OT 정책 / 야간·휴일 계산 [우선순위2]
- **OT 자동생성 정책(`ot_auto_enabled`)**: 근무조(shift)별로 8h 초과분 자동 OT 생성 여부를 제어.
  - `ot_auto_enabled=false`(정규 근무조): 자동 OT 미생성(0h). `true`: 기존대로 8h 초과분 자동 산출.
  - **수동 OT 우선**: 사용자가 직접 입력한 OT(`overtime_hours`)가 있으면 자동 계산을 덮어쓰지 않고 우선 적용(`upsertScheduleWithCalc`).
- **야간/휴일 계산 유지**: OT 정책과 무관하게 야간(22:00~06:00 교집합)·휴일(토/일/공휴일) 시간은 항상 계산·저장(`night_work_hours`/`holiday_work_hours`).
- **copy-week 엔진 통합**: 주간 복사 시에도 동일한 `calcWorkHours`/`aggregateAllowanceHours` SSOT 엔진을 사용해 OT/야간/휴일 시간 정합성 보장.
- **버그 수정**: `standard_hours`/`half_type` 저장 누락 버그 수정(셀 저장 시 정상 반영).

## 근무 스케줄 — 운영분석/병원장/QR 강화 [우선순위3]
- **STEP1 운영분석(영양사)**: 야간근무·휴일근무·OT **발생 직원 수** KPI 추가 / 직원별 요약표에 **OT·야간·휴일 시간** 컬럼 추가 / 알림 영역에 OT·야간·휴일 발생 직원 전체 표시(접이식 상세).
  - 서버: `GET /api/schedule/analysis/:year/:month` → `monthly.nightByEmp`/`holidayByEmp`/`totalNightHours`/`totalHolidayHours` 추가(`night_work_hours>0`/`holiday_work_hours>0` 기준).
- **STEP2 병원장**: 야간근무 총시간·휴일근무 총시간·**야간/휴일 발생 직원 수** 카드 추가 / **OT·야간·휴일 TOP 5 직원** 리스트 추가.
  - 서버: `GET /api/executive/staff-labor/:year/:month` → `workSummary.totalNightHours`/`totalHolidayHours`/`nightEmpCount`/`holidayEmpCount` 추가(byEmployee 기반 합산, 기존 집계 미변경).
- **STEP3 개인 QR 근무표(`/my-schedule/:token`)**:
  - **변경이력 월필터 버그 수정**: 기존 `changed_at >= datetime('now','-30 days')`(절대 30일) → **조회 월의 `work_date` 범위** 기준으로 변경(다른 달 이력 노출 차단).
  - **개인정보 카드 추가**: 보건증 만료일 / 남은 연차 / 이번달 OT·야간·휴일 시간 / 근무일수 / 휴무일수.
  - **보건증 상태 배지**: 90일↑ 정상(초록) / 30~90일 주의(노랑) / 30일↓ 만료 임박(주황) / 만료 위험(빨강) / 미등록(회색).
  - 서버: `GET /api/schedule/public/:token` → `stats`(workDays/restDays/otHours/nightHours/holidayHours/annualRemain/healthCert*) 필드 추가. 연차는 `employee_leaves` annual SSOT(`total + carried_over − initial_used − used`) 기준.
- **영향 없음**: 식단가 엔진 / hospitalCalc.ts / 외부인력 엔진 / daily_orders / daily_meals (회귀 테스트 완료, 기존 필드 전부 유지).

## 배포
- **플랫폼**: Cloudflare Pages (프로덕션: https://reh-nutrition.pages.dev)
- **빌드**: Vite + Hono TypeScript
- **상태**: ✅ 운영 중
- **캐시 태그**: app.js `20260606-priority3` / executive.js `20260606-priority3`
- **최종 업데이트**: 2026-06-06 (우선순위3 — 운영분석/병원장/QR 야간·휴일·보건증 강화)
# Auto deploy test Sun Apr 12 17:04:05 UTC 2026
