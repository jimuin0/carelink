#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${PGDATABASE:-carelink_shadow}"
export PGDATABASE="$DB_NAME"
TMP_DIR="$(mktemp -d)"
BOOKING_ID="eeee0000-0000-4000-8000-000000000021"
STAFF_ID="eeee0000-0000-4000-8000-000000000022"
USER_ID="eeee0000-0000-4000-8000-000000000023"
SAME_KEY="eeee0000-0000-4000-8000-000000000031"
REUSED_KEY="eeee0000-0000-4000-8000-000000000032"
BOOKING_DATE="$(date -u -d '+180 days' +%F)"

cleanup() {
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" >/dev/null 2>&1 <<SQL || true
DROP TRIGGER IF EXISTS _carelink_test_pause_booking_insert ON public.bookings;
DROP TRIGGER IF EXISTS _carelink_test_pause_refund_insert ON public.user_points;
DROP FUNCTION IF EXISTS public._carelink_test_pause_booking_insert();
DROP FUNCTION IF EXISTS public._carelink_test_pause_refund_insert();
DELETE FROM public.customer_visits WHERE booking_id IN (SELECT id FROM public.bookings WHERE idempotency_key IN ('$SAME_KEY', '$REUSED_KEY'));
DELETE FROM public.user_points WHERE user_id = '$USER_ID' OR booking_id IN (SELECT id FROM public.bookings WHERE idempotency_key IN ('$SAME_KEY', '$REUSED_KEY'));
DELETE FROM public.bookings WHERE idempotency_key IN ('$SAME_KEY', '$REUSED_KEY');
DELETE FROM public.staff_profiles WHERE id = '$STAFF_ID';
DELETE FROM public.facility_profiles WHERE id = '$BOOKING_ID';
DELETE FROM auth.users WHERE id = '$USER_ID';
SQL
  rm -r -- "$TMP_DIR"
}
trap cleanup EXIT

psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f supabase/tests/booking-points-atomic-concurrency-setup.sql >/dev/null

create_request() {
  local key="$1" customer="$2" email="$3" time="$4" end_time="$5"
  psql -X -At -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "SET ROLE service_role; SELECT public.create_booking_with_points_atomic('$BOOKING_ID', '$STAFF_ID', '$USER_ID', NULL, NULL, '$BOOKING_DATE', '$time', '$end_time', '$customer', '$email', NULL, NULL, 5000, '$key', 20, 'pending', false, NULL);"
}

cancel_request() {
  psql -X -At -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "SET ROLE service_role; SELECT public.cancel_booking_with_points_atomic((SELECT id FROM public.bookings WHERE idempotency_key = '$SAME_KEY'), '$BOOKING_ID', '$USER_ID', 'pending');"
}

assert_one_true_one_false() {
  local first="$1" second="$2" true_field="$3" false_field="$4"
  grep -Fq "$true_field" "$first" "$second" || { echo "missing $true_field in concurrent responses" >&2; return 1; }
  grep -Fq "$false_field" "$first" "$second" || { echo "missing $false_field in concurrent responses" >&2; return 1; }
}

wait_for_pair() {
  local label="$1" first_pid="$2" second_pid="$3" first_err="$4" second_err="$5"
  local first_rc=0 second_rc=0
  if wait "$first_pid"; then :; else first_rc=$?; fi
  if wait "$second_pid"; then :; else second_rc=$?; fi
  if [[ "$first_rc" -ne 0 || "$second_rc" -ne 0 ]]; then
    echo "$label failed (exit codes $first_rc / $second_rc):" >&2
    for err_file in "$first_err" "$second_err"; do
      if [[ -s "$err_file" ]]; then sed -n '1,80p' "$err_file" >&2; fi
    done
    return 1
  fi
}

# The first transaction sleeps after taking its advisory lock. The second starts
# while it holds the lock and must replay the committed booking after waiting.
(create_request "$SAME_KEY" 'Concurrency test same-key' 'same-key@example.invalid' '10:00' '11:00' >"$TMP_DIR/same-a" 2>"$TMP_DIR/same-a.err") &
same_a_pid=$!
sleep 0.2
(create_request "$SAME_KEY" 'Concurrency test same-key' 'same-key@example.invalid' '10:00' '11:00' >"$TMP_DIR/same-b" 2>"$TMP_DIR/same-b.err") &
same_b_pid=$!
wait_for_pair 'same-key retry race' "$same_a_pid" "$same_b_pid" "$TMP_DIR/same-a.err" "$TMP_DIR/same-b.err"
assert_one_true_one_false "$TMP_DIR/same-a" "$TMP_DIR/same-b" '"replayed": true' '"replayed": false'

same_booking_count="$(psql -X -At -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "SELECT count(*) FROM public.bookings WHERE idempotency_key = '$SAME_KEY';")"
same_debit_count="$(psql -X -At -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "SELECT count(*) FROM public.user_points WHERE booking_id IN (SELECT id FROM public.bookings WHERE idempotency_key = '$SAME_KEY') AND points = -20;")"
[[ "$same_booking_count" == "1" && "$same_debit_count" == "1" ]] || { echo "same-key retry created $same_booking_count bookings and $same_debit_count debits" >&2; exit 1; }

# Reusing one key with different data concurrently must create only one booking;
# the other request must receive IDEMPOTENCY_KEY_REUSED rather than a second side effect.
(create_request "$REUSED_KEY" 'Concurrency test payload A' 'payload-a@example.invalid' '12:00' '13:00' >"$TMP_DIR/reuse-a" 2>"$TMP_DIR/reuse-a.err") &
reuse_a_pid=$!
sleep 0.2
set +e
create_request "$REUSED_KEY" 'Concurrency test payload B' 'payload-b@example.invalid' '13:00' '14:00' >"$TMP_DIR/reuse-b" 2>"$TMP_DIR/reuse-b.err" &
reuse_b_pid=$!
if wait "$reuse_a_pid"; then reuse_a_rc=0; else reuse_a_rc=$?; fi
if wait "$reuse_b_pid"; then reuse_b_rc=0; else reuse_b_rc=$?; fi
set -e
if [[ "$reuse_a_rc" -eq 0 && "$reuse_b_rc" -ne 0 ]]; then
  if ! grep -Fq 'IDEMPOTENCY_KEY_REUSED' "$TMP_DIR/reuse-b.err"; then
    echo 'different-payload loser did not report IDEMPOTENCY_KEY_REUSED:' >&2
    sed -n '1,80p' "$TMP_DIR/reuse-b.err" >&2
    exit 1
  fi
elif [[ "$reuse_b_rc" -eq 0 && "$reuse_a_rc" -ne 0 ]]; then
  if ! grep -Fq 'IDEMPOTENCY_KEY_REUSED' "$TMP_DIR/reuse-a.err"; then
    echo 'different-payload loser did not report IDEMPOTENCY_KEY_REUSED:' >&2
    sed -n '1,80p' "$TMP_DIR/reuse-a.err" >&2
    exit 1
  fi
else
  echo "different-payload key race returned unexpected exit codes: $reuse_a_rc / $reuse_b_rc" >&2
  sed -n '1,80p' "$TMP_DIR/reuse-a.err" "$TMP_DIR/reuse-b.err" >&2
  exit 1
fi
reused_booking_count="$(psql -X -At -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "SELECT count(*) FROM public.bookings WHERE idempotency_key = '$REUSED_KEY';")"
[[ "$reused_booking_count" == "1" ]] || { echo "different-payload key race created $reused_booking_count bookings" >&2; exit 1; }

# Competing cancellation calls must produce exactly one CAS winner and one refund.
(cancel_request >"$TMP_DIR/cancel-a" 2>"$TMP_DIR/cancel-a.err") &
cancel_a_pid=$!
sleep 0.2
(cancel_request >"$TMP_DIR/cancel-b" 2>"$TMP_DIR/cancel-b.err") &
cancel_b_pid=$!
wait_for_pair 'concurrent cancellation race' "$cancel_a_pid" "$cancel_b_pid" "$TMP_DIR/cancel-a.err" "$TMP_DIR/cancel-b.err"
assert_one_true_one_false "$TMP_DIR/cancel-a" "$TMP_DIR/cancel-b" '"cancelled": true' '"cancelled": false'
refund_count="$(psql -X -At -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "SELECT count(*) FROM public.user_points WHERE booking_id IN (SELECT id FROM public.bookings WHERE idempotency_key = '$SAME_KEY') AND reason = 'キャンセル返還' AND points = 20;")"
[[ "$refund_count" == "1" ]] || { echo "concurrent cancellation created $refund_count refunds" >&2; exit 1; }

echo 'booking points/idempotency concurrency integration passed'
