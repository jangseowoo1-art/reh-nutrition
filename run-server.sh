#!/bin/bash
# 서버 시작 스크립트 - DB 초기화 후 wrangler pages dev 실행
cd /home/user/webapp

# ── 포트 3000 점유 프로세스 강제 종료 ──────────────────────────
echo "포트 3000 정리 중..."
fuser -k 3000/tcp 2>/dev/null || true
# workerd/wrangler 잔여 프로세스 정리
pkill -f "workerd.*3000" 2>/dev/null || true
sleep 2

DB_DIR=".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
DB_FILE=$(ls $DB_DIR/*.sqlite 2>/dev/null | head -1)

# DB가 없거나 비어있으면 임시 wrangler로 DB 초기화
if [ -z "$DB_FILE" ] || [ ! -s "$DB_FILE" ]; then
  echo "DB 초기화 중..."
  # 임시로 wrangler를 백그라운드 실행해서 DB 생성
  fuser -k 3001/tcp 2>/dev/null || true
  timeout 10 npx wrangler pages dev dist --persist-to .wrangler/state --ip 0.0.0.0 --port 3001 > /tmp/wrangler-init.log 2>&1 &
  INIT_PID=$!
  sleep 6
  
  # DB 파일 생성 확인
  DB_FILE=$(ls $DB_DIR/*.sqlite 2>/dev/null | head -1)
  if [ -n "$DB_FILE" ]; then
    echo "DB 파일 생성됨"
  fi
  
  # 초기화 wrangler 종료
  kill $INIT_PID 2>/dev/null
  wait $INIT_PID 2>/dev/null
  sleep 2
  
  # 마이그레이션 적용
  echo "마이그레이션 적용 중..."
  npx wrangler d1 migrations apply hospital-meal-production --local --persist-to .wrangler/state 2>&1 | grep -E "✅|🕒|Applied|complete" || true
  echo "마이그레이션 완료!"
else
  echo "DB 파일 존재함, 마이그레이션 확인 중..."
  # DB가 있어도 새 마이그레이션이 있으면 적용
  npx wrangler d1 migrations apply hospital-meal-production --local --persist-to .wrangler/state 2>&1 | grep -E "✅|🕒|Applied|complete|No migrations" || true
fi

# 본 서버 실행
echo "서버 시작 중..."
exec npx wrangler pages dev dist --persist-to .wrangler/state --ip 0.0.0.0 --port 3000
