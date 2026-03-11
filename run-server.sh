#!/bin/bash
# 서버 시작 스크립트 - wrangler pages dev 실행 후 DB 초기화
cd /home/user/webapp

# wrangler pages dev를 백그라운드로 실행
npx wrangler pages dev dist --persist-to .wrangler/state --ip 0.0.0.0 --port 3000 &
WRANGLER_PID=$!

# wrangler가 DB 파일을 생성할 때까지 대기 (최대 15초)
echo "wrangler 시작 대기 중..."
for i in $(seq 1 15); do
  sleep 1
  if ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite 2>/dev/null | head -1 | grep -q ".sqlite"; then
    echo "DB 파일 감지됨 (${i}초)"
    break
  fi
done

# 모든 마이그레이션 적용
echo "마이그레이션 적용 중..."
npx wrangler d1 migrations apply hospital-meal-production --local 2>&1 | grep -E "✅|🕒|Error|error" || true
echo "마이그레이션 완료!"

# wrangler 프로세스 대기
wait $WRANGLER_PID
