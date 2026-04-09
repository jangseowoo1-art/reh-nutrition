# 🏥 급식 예산관리 시스템 인수인계서
> 작성일: 2026-04-09  
> 샌드박스: Novita AI (기존 샌드박스 ID 그대로 유지)

---

## ✅ 새 채팅방 시작 시 첫 메시지 (그대로 복사해서 사용)

```
급식 예산관리 시스템 개발을 이어서 진행합니다.

[환경정보]
- 샌드박스: 기존 Novita AI 샌드박스 그대로 유지 (재사용)
- 프로젝트 경로: /home/user/webapp
- PM2 앱 이름: hospital-meal
- 서비스 포트: 3000
- DB 파일: /home/user/webapp/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c1d1e6f550688b742edd79dd88a75718f5137a380244b7655328b4febec74c4f.sqlite
- DB 백업: /home/user/webapp/backup_full_db_20260409_*.sql
- 인수인계서: /home/user/webapp/HANDOVER.md 를 먼저 읽어주세요

[서비스 재시작 명령어]
cd /home/user/webapp && npm run build && pm2 restart hospital-meal

[요청 작업]
← 여기에 원하는 작업 입력
```

---

## 1. 프로젝트 기본 정보

| 항목 | 내용 |
|------|------|
| 프로젝트 경로 | `/home/user/webapp` |
| 서비스 포트 | 3000 |
| 프레임워크 | Hono (TypeScript) + Cloudflare Pages |
| DB 종류 | SQLite (Wrangler D1 local) |
| DB 이름 | `hospital-meal-production` |
| DB 파일 경로 | `/home/user/webapp/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c1d1e6f550688b742edd79dd88a75718f5137a380244b7655328b4febec74c4f.sqlite` |
| PM2 앱 이름 | `hospital-meal` |
| 빌드 출력 | `/home/user/webapp/dist/` |
| 프론트엔드 | `/home/user/webapp/public/static/app.js` (단일 파일, 약 37,000줄) |

---

## 2. 서비스 시작 / 재시작 방법

```bash
# 포트 정리 후 빌드 + 시작
fuser -k 3000/tcp 2>/dev/null || true
cd /home/user/webapp && npm run build
cd /home/user/webapp && pm2 start ecosystem.config.cjs

# 이미 실행 중일 때 재시작
cd /home/user/webapp && npm run build && pm2 restart hospital-meal

# 서비스 확인
curl http://localhost:3000/   # 200 OK 이면 정상

# 로그 확인
pm2 logs hospital-meal --nostream
```

---

## 3. 주요 파일 구조

```
/home/user/webapp/
├── src/
│   ├── index.tsx                  # 메인 Hono 앱 (라우팅 진입점)
│   └── routes/
│       ├── orders.ts              # 발주 입력 API
│       ├── meals.ts               # 식수 입력 API
│       ├── dashboard.ts           # 대시보드 API
│       ├── settings.ts            # 설정 API (업체, 예산 등)
│       ├── schedule.ts            # 스케줄 관리 API
│       ├── auth.ts                # 로그인/인증 API
│       ├── card_expenses.ts       # 법인카드 지출 API
│       └── admin.ts               # 관리자 API
├── public/static/
│   └── app.js                     # ⚠️ 프론트엔드 전체 (약 37,000줄 단일 파일)
├── migrations/                    # DB 마이그레이션 SQL 파일들
├── wrangler.jsonc                 # Cloudflare Workers 설정
├── ecosystem.config.cjs           # PM2 설정
├── vite.config.ts                 # 빌드 설정
├── package.json
├── backup_full_db_20260409_*.sql  # DB 전체 백업 (SQL dump)
└── HANDOVER.md                    # 이 인수인계서
```

---

## 4. 로그인 계정 정보 (users 테이블)

| id | username | role | 병원 |
|----|----------|------|------|
| 1 | admin | admin | 전체 관리자 |
| 2 | amina | hospital | 아미나 병원 (id=1) |
| 3 | muijae | hospital | 무이재 한방병원 (id=2) |
| 4 | hosp03 | hospital | 늘봄요양병원 (id=3) |
| 5 | hosp04 | hospital | 무이재 의원 (id=4) |
| 9 | mu1 | hospital | 무이재 의원 (id=4) |
| 10 | exec_test | executive | 아미나 병원 (임원용) |

> ⚠️ 비밀번호는 DB에 해시 저장됨. 분실 시 admin 계정으로 재설정 필요.

---

## 5. 병원 목록 (hospitals 테이블)

| id | 병원명 | 비고 |
|----|--------|------|
| 1 | 아미나 병원 | 직원 13명, 스케줄 관리 사용 중 |
| 2 | 무이재 한방병원 | 직원 2명 |
| 3 | 늘봄요양병원 | 주요 작업 대상 |
| 4 | 무이재 의원 | |
| 5~7 | 병원5, 병원6, 병원7 | 테스트용 (미사용) |

---

## 6. 병원별 업체 목록 (vendors 테이블)

### 아미나 병원 (hospital_id=1) - 활성 업체만

| id | 업체명 | 분류 | 월예산 | 세금유형 |
|----|--------|------|--------|----------|
| 26 | 푸드힐 | market | 25,000,000 | mixed_total |
| 27 | 푸드힐(소모품) | supply | 700,000 | mixed_total |
| 28 | 대동청과 | fruit | 5,000,000 | exempt |
| 29 | 이산푸드 | market | 10,000,000 | mixed_total |
| 30 | 하나로미트 | meat | 4,000,000 | exempt |
| 31 | 이벤트 | event | 2,000,000 | mixed_total |
| 32 | 법인카드(온라인) | card | 1,500,000 | mixed_total |
| 33 | 법인카드(소모품) | supply | 300,000 | mixed_total |

### 무이재 한방병원 (hospital_id=2) - 전체 활성

| id | 업체명 | 분류 | 월예산 | 세금유형 |
|----|--------|------|--------|----------|
| 11 | 삼성 웰스토리 | major | 33,000,000 | mixed |
| 12 | 아워홈 | major | 45,000,000 | mixed |
| 13 | 하나로미트(육류) | meat | 8,500,000 | exempt |
| 14 | 한살림 | organic | 500,000 | exempt |
| 15 | 낙원(떡) | general | 1,000,000 | exempt |
| 16 | 청과(사과) | fruit | 1,500,000 | exempt |
| 17 | 돌핀 | delivery | 500,000 | exempt |
| 18 | 이벤트 | event | 5,000,000 | mixed |
| 19 | 유튜브(인터넷) | delivery | 0 | taxable |

### 늘봄요양병원 (hospital_id=3) - 전체 활성

| id | 업체명 | 분류 | 월예산 | 세금유형 |
|----|--------|------|--------|----------|
| 20 | 삼성웰스토리 | major | 40,000,000 | mixed |
| 21 | 현지 육류업체 | meat | 3,000,000 | exempt |
| 22 | 이산유통 | market | 20,000,000 | mixed_total |
| 23 | 호일헬스케어(뉴케어) | market | 3,000,000 | taxable |
| 24 | 경기메디칼(그린비아) | market | 2,000,000 | taxable |
| 25 | 신진세척기 | market | 700,000 | taxable |
| 42 | 삼성웰스토리(소모품) | supply | 500,000 | mixed_total |

### 무이재 의원 (hospital_id=4)

| id | 업체명 | 분류 | 월예산 | 세금유형 |
|----|--------|------|--------|----------|
| 34 | 아워홈 | major | 10,000,000 | mixed |
| 35 | 칠복청과(사과) | market | 200,000 | exempt |
| 36 | 하나로 미트 | meat | 1,000,000 | exempt |

---

## 7. 병원별 환자 카테고리 (hospital_patient_categories)

| 병원 | id | key | 이름 |
|------|----|-----|------|
| 아미나 병원 | 3 | cancer | 항암 |
| 무이재 한방병원 | 10 | cancer | 항암 |
| 늘봄요양병원 | 1 | cancer | 항암 |
| 늘봄요양병원 | 2 | nursing | 요양 |
| 늘봄요양병원 | 15 | other | 항암 보호자 |
| 늘봄요양병원 | 19 | general | 경관식 |
| 무이재 의원 | 9 | cancer | 항암 |

---

## 8. 병원별 식단 카테고리 (diet_categories)

### 아미나 병원 (hospital_id=1)
| id | diet_key | 이름 |
|----|----------|------|
| 3 | legacy_cancer | 항암 |
| 8 | preset_therapy_gastrectomy_1 | 위절제식 |
| 9 | preset_therapy_lowresidue_1 | 저잔사식 |
| 10 | preset_therapy_lowiodine_1 | 저요오드식 |
| 11 | preset_staff_regular_1 | 직원 일반식 |
| 12 | preset_nc_guardian_1 | 보호자식 |
| 13 | preset_nc_outpatient_1 | 외래환자식 |
| 14 | preset_patient_rehab_1 | 재활 일반식 |
| 25 | preset_staff_special_1 | 직원 특식 |
| 32 | preset_staff_night_1 | 직원 야식 |

### 무이재 한방병원 (hospital_id=2)
| id | diet_key | 이름 |
|----|----------|------|
| 5 | legacy_cancer | 항암 |
| 31 | preset_staff_special_1 | 직원 특식 |
| 38 | preset_staff_night_1 | 직원 야식 |
| 41 | preset_therapy_gastrectomy_2 | 위절제식 |
| 42 | preset_therapy_lowresidue_2 | 저잔사식 |
| 43 | preset_therapy_lowiodine_2 | 저요오드식 |
| 44 | preset_therapy_other_2 | 기타 치료식 |
| 45 | preset_nc_guardian_2 | 보호자식 |
| 46 | preset_nc_rice_extra_2 | 공기밥추가 |
| 47 | preset_staff_general_2 | 직원 일반식 |

### 늘봄요양병원 (hospital_id=3)
| id | diet_key | 이름 |
|----|----------|------|
| 1 | legacy_cancer | 항암 |
| 2 | legacy_nursing | 요양 |
| 6 | legacy_other | 항암 보호자 |
| 7 | legacy_general | 경관식 |
| 15 | preset_nc_guardian_3 | 보호자식 |
| 26 | preset_staff_special_1 | 직원 특식 |
| 33 | preset_staff_night_1 | 직원 야식 |
| 39 | preset_nc_nursing_guardian_3 | 요양 보호자식 |
| 40 | preset_nc_caregiver_3 | 간병사 |
| 48 | preset_staff_general_3 | 직원 일반식 |

### 무이재 의원 (hospital_id=4)
| id | diet_key | 이름 |
|----|----------|------|
| 4 | legacy_cancer | 항암 |
| 27 | preset_staff_special_1 | 직원 특식 |
| 34 | preset_staff_night_1 | 직원 야식 |

---

## 9. 병원별 월별 예산 설정 (monthly_settings)

| 병원 | 년 | 월 | 총예산 | 식단가 | 근무일 | 소모품예산 | 카드예산 |
|------|----|----|--------|--------|--------|------------|----------|
| 아미나 병원 | 2026 | 2 | 60,000,000 | 8,000 | 31 | 0 | 0 |
| 아미나 병원 | 2026 | 3 | 48,500,000 | 8,000 | 31 | 0 | 0 |
| 아미나 병원 | 2026 | 4 | 48,500,000 | 8,000 | 30 | 0 | 0 |
| 무이재 한방병원 | 2026 | 2 | 0 | 0 | 0 | 0 | 0 |
| 무이재 한방병원 | 2026 | 3 | 90,000,000 | 7,490 | 31 | 0 | 0 |
| 늘봄요양병원 | 2026 | 3 | 68,700,000 | 3,593 | 31 | 684,000 | 0 |
| 늘봄요양병원 | 2026 | 4 | 69,200,000 | 4,249 | 30 | 600,000 | 0 |
| 무이재 의원 | 2026 | 2 | 11,200,000 | 6,000 | 31 | 200,000 | 500,000 |
| 무이재 의원 | 2026 | 3 | 11,200,000 | 6,000 | 31 | 200,000 | 500,000 |
| 무이재 의원 | 2026 | 4 | 11,200,000 | 6,000 | 22 | 200,000 | 500,000 |

---

## 10. 전체 병원 데이터 현황

### 발주 입력 (daily_orders)
| 병원명 | 월 | 건수 | 합계금액 |
|--------|----|------|----------|
| 아미나 병원 | 2026-02 | 106건 | 55,865,911원 |
| 아미나 병원 | 2026-03 | 126건 | 62,448,429원 |
| 무이재 한방병원 | 2026-02 | 88건 | 94,531,387원 |
| 무이재 한방병원 | 2026-03 | 94건 | 94,786,136원 |
| 늘봄요양병원 | 2026-02 | 99건 | 65,855,150원 |
| 늘봄요양병원 | 2026-03 | 133건 | 70,294,014원 |
| 무이재 의원 | 2026-03 | 4건 | 2,023,456원 |

### 식수 입력 (daily_meals)
| 병원명 | 월 | 건수 |
|--------|----|------|
| 아미나 병원 | 2026-02 | 28일치 |
| 아미나 병원 | 2026-03 | 31일치 |
| 무이재 한방병원 | 2026-02 | 28일치 |
| 무이재 한방병원 | 2026-03 | 28일치 |
| 늘봄요양병원 | 2026-03 | 31일치 |
| 무이재 의원 | 2026-03 | 1일치 |

### 스케줄 입력 (daily_schedules)
| 병원명 | 월 | 건수 |
|--------|----|------|
| 아미나 병원 | 2026-03 | 408건 |
| 아미나 병원 | 2026-04 | 1건 |
| 무이재 한방병원 | 2026-03 | 3건 |

---

## 11. 직원 목록

### 아미나 병원 (hospital_id=1) - 13명
| id | 이름 | 직책 | 분류 |
|----|------|------|------|
| 4 | 이재욱 | 책임셰프 | cook |
| 5 | 강금화 | - | cook |
| 6 | 안정임 | - | cook |
| 7 | 차숙청 | - | cook |
| 8 | 조소희 | - | cook |
| 9 | 김연정 | - | cook |
| 10 | 박연숙 | - | cook |
| 11 | 김효진 | - | cook |
| 12 | 윤미숙 | - | cook |
| 13 | 조미영 | - | cook |
| 14 | 이현정 | - | cook |
| 15 | 최혜진 | 팀장 | nutrition |
| 16 | 문나은 | 영양사 | nutrition |

### 무이재 한방병원 (hospital_id=2) - 2명
| id | 이름 | 직책 | 분류 |
|----|------|------|------|
| 2 | 홍길동 | 조리장 | cook |
| 3 | 김영양 | 영양사 | nutrition |

### 아미나 병원 교대 근무 유형 (schedule_shifts)
| id | 이름 | 코드 | 시작 | 종료 |
|----|------|------|------|------|
| 1 | 오전 | A | 06:00 | 15:00 |
| 2 | 오후 | B | 10:00 | 19:00 |
| 3 | 종일 | F | 06:00 | 19:00 |

---

## 12. 이번 세션 완료 작업 (버그 수정 이력)

### ✅ Bug Fix 1: 소모품 업체 - 입력 없는 날 누적 발주 오류
- **파일**: `public/static/app.js` 약 3894~3929줄
- **증상**: 늘봄요양병원 삼성웰스토리(소모품) - 3월 10일 입력 없는데 19,030원 표시
- **원인**: `dk <= dateStr` 비교로 당일 저장값(`savedToday`)이 포함됨
- **수정**: `dk < dateStr`로 변경 → 당일은 live값 또는 saved값만 별도 합산

### ✅ Bug Fix 2: 소모품 업체 - 상단 카드 월합계 중복 합산 오류
- **파일**: `public/static/app.js` 약 3063~3078줄
- **증상**: 492만원 표시 (실제 37만원)
- **원인**: `patient_category_id`별로 중복된 행들이 `orderList`에서 모두 합산됨
- **수정**: supply/card/event 업체는 `window._supplyDailyMap`(날짜별 그룹) 기준으로 집계

### ✅ Bug Fix 3: 식수 입력 - 엑셀 붙여넣기 일부 숫자 오류
- **파일**: `public/static/app.js` 약 8718~8779줄
- **증상**: 엑셀에서 복사 붙여넣기 시 일부 숫자가 입력되지 않음
- **원인 1**: `_parseNum`이 쉼표 포함 숫자(`1,234`), 원화기호(`₩`, `￦`) 처리 못함
- **원인 2**: 순수 텍스트 셀(합계 라벨 등) 건너뛸 때 이후 열이 밀림
- **원인 3**: 붙여넣기 후 행 소계가 즉시 갱신 안됨
- **수정**: `_parseNum` 쉼표/기호 제거 강화, 텍스트 셀 처리 개선, `input` 이벤트 발생

### ✅ Bug Fix 4: 실시간 식단가 계산에 소모품 금액 포함 오류
- **파일**: `public/static/app.js` 약 6027~6044줄 및 6581~6591줄
- **증상**: 실시간 식단가가 높게 표시 (소모품 발주금액이 식단가 분자에 포함됨)
- **원인**: `_catDailyMap` 순회 시 `is_card_type`만 체크하고 `supply` 카테고리 제외 안됨
- **수정**: `vendorObj.category === 'supply' || 'card' || 'event'` 조건 추가로 제외 처리

### ✅ Bug Fix 5: 환자군별 월 식단가 요양 발주금액 과다 표시
- **파일**: `public/static/app.js` 약 6581줄 (catMonthAmtLive 계산)
- **증상**: 요양 월 발주 금액이 4,857만원으로 과다 표시 (소모품 포함됨)
- **원인**: supply 업체 발주가 `patient_category_id=2`(요양)으로 저장되어 요양 식단가에 합산
- **수정**: supply/card/event 업체 제외 조건 추가

### ✅ Bug Fix 6: 삼성웰스토리(소모품) 초기 금액 0원 표시
- **파일**: `public/static/app.js` 약 3900~3930줄
- **증상**: 소모품 업체 오늘 발주 금액이 저장 전에 0원으로 표시
- **원인**: `supplyTodayTotal`이 `_catDailyMap`에서만 조회하여 초기 로드 시 데이터 없음
- **수정**: `_supplyDailyMap[dateStr]`(API에서 받은 저장값)을 fallback으로 추가

### ✅ Bug Fix 7: 신진세척기 → supply 분류 변경
- **DB**: vendors 테이블 id=25 (`category='market'` → `category='supply'`, name='신진세척기(소모품)')
- **효과**: 신진세척기가 식단가 계산에서 제외되고 소모품 섹션에 표시됨

### ✅ Bug Fix 8: 환자군별 식수 오류 (항암 2,926식 / 요양 22,127식)
- **DB**: hospital_patient_categories 테이블 meals_include_keys 수정
- **항암 (id=1)**: `["cat_cancer","nc_key_legacy_other"]` → `["cat_cancer"]` (항암 보호자 제외)
- **요양 (id=2)**: `["st_key_...", "cat_nursing", "th_key_...", "nc_key_...", ...]` → `["cat_nursing"]` (직원/보호자/간병사 제외)
- **수정 후 예상값**: 항암 2,926식, 요양 10,041식 (3월 기준)

---

## 13. DB 복구 방법 (데이터 사라졌을 때)

```bash
DB_FILE="/home/user/webapp/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c1d1e6f550688b742edd79dd88a75718f5137a380244b7655328b4febec74c4f.sqlite"

# ⚠️ 기존 DB 삭제 후 백업에서 복구
rm -f "$DB_FILE"
sqlite3 "$DB_FILE" < /home/user/webapp/backup_full_db_20260409_*.sql

# 복구 확인
sqlite3 "$DB_FILE" "SELECT h.name, COUNT(*) FROM daily_orders d JOIN hospitals h ON d.hospital_id=h.id GROUP BY d.hospital_id;"
```

---

## 14. 자주 쓰는 DB 조회 명령어

```bash
DB_FILE="/home/user/webapp/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c1d1e6f550688b742edd79dd88a75718f5137a380244b7655328b4febec74c4f.sqlite"

# 발주 데이터 확인
sqlite3 "$DB_FILE" "SELECT h.name, substr(order_date,1,7), COUNT(*), SUM(total_amount) FROM daily_orders d JOIN hospitals h ON d.hospital_id=h.id GROUP BY d.hospital_id, substr(order_date,1,7) ORDER BY d.hospital_id, order_date;"

# 식수 데이터 확인
sqlite3 "$DB_FILE" "SELECT h.name, substr(meal_date,1,7), COUNT(*) FROM daily_meals m JOIN hospitals h ON m.hospital_id=h.id GROUP BY m.hospital_id, substr(meal_date,1,7);"

# 특정 병원 특정 월 발주 상세
sqlite3 "$DB_FILE" "SELECT d.order_date, v.name, d.total_amount FROM daily_orders d JOIN vendors v ON d.vendor_id=v.id WHERE d.hospital_id=3 AND d.order_date LIKE '2026-03%' ORDER BY d.order_date, v.name;"
```

---

## 15. 백업 파일

| 파일 | 설명 | 다운로드 |
|------|------|----------|
| `/home/user/webapp/backup_full_db_20260409_*.sql` | DB 전체 SQL 덤프 | 샌드박스 내부 |
| `/home/user/webapp_full_backup_20260409_*.tar.gz` | 코드+DB 전체 tar.gz | 샌드박스 내부 |
| ProjectBackup 업로드 | 코드+DB 전체 | https://www.genspark.ai/api/files/s/QBV7KsYt |
