#!/bin/bash
# 서버 시작 전 DB 초기화 스크립트
# wrangler pages dev가 새 DB를 생성한 후 마이그레이션을 자동 적용

echo "🔧 DB 초기화 시작..."
cd /home/user/webapp

# 잠시 대기 (wrangler 시작 시간)
sleep 3

# 현재 DB 테이블 확인
TABLES=$(npx wrangler d1 execute hospital-meal-production --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name='users'" 2>/dev/null | grep -c '"name": "users"' || echo "0")

if [ "$TABLES" = "0" ]; then
  echo "📦 테이블이 없음 - 마이그레이션 실행"
  cat migrations/0001_initial.sql migrations/0002_seed.sql > /tmp/combined_migration.sql
  npx wrangler d1 execute hospital-meal-production --local --file=/tmp/combined_migration.sql 2>&1 | grep -E "success|error|Error" || true
  echo "✅ 마이그레이션 완료"
else
  echo "✅ DB 이미 초기화됨"
fi
