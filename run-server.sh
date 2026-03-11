#!/bin/bash
# 서버 시작 스크립트 - wrangler pages dev 실행 후 DB 초기화
cd /home/user/webapp

# wrangler pages dev를 백그라운드로 실행
npx wrangler pages dev dist --persist-to .wrangler/state --ip 0.0.0.0 --port 3000 &
WRANGLER_PID=$!

# wrangler가 DB를 생성할 때까지 대기
echo "wrangler 시작 대기 중..."
sleep 6

# DB에 테이블이 없으면 마이그레이션 실행
echo "DB 초기화 확인..."
TABLE_COUNT=$(npx wrangler d1 execute hospital-meal-production --local --command="SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='users'" 2>/dev/null | grep -o '"cnt": [0-9]*' | grep -o '[0-9]*' || echo "0")

if [ "$TABLE_COUNT" = "0" ] || [ -z "$TABLE_COUNT" ]; then
  echo "테이블 없음 - 마이그레이션 실행..."
  cat migrations/0001_initial.sql migrations/0002_seed.sql > /tmp/combined_migration.sql
  npx wrangler d1 execute hospital-meal-production --local --file=/tmp/combined_migration.sql 2>&1 | tail -3
  echo "마이그레이션 완료!"
else
  echo "DB 이미 초기화됨 (테이블 수: $TABLE_COUNT)"
fi

# wrangler 프로세스 대기
wait $WRANGLER_PID
