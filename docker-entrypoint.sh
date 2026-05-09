#!/bin/sh
set -e
echo "Waiting for Postgres (compose race after host/docker restart)..."
ok=0
i=0
while [ "$i" -lt 60 ]; do
  if node -e 'require("net").connect(5432,"postgres",function(){process.exit(0)}).on("error",function(){process.exit(1)})'; then
    ok=1
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "Timeout: Postgres not reachable at postgres:5432"
  exit 1
fi
echo "Running Prisma migrations..."
npx prisma migrate deploy
exec "$@"
