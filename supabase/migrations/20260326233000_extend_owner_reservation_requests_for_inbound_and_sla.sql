alter table public.owner_reservation_requests
  add column if not exists second_reminder_at timestamptz,
  add column if not exists second_reminder_sent_at timestamptz,
  add column if not exists owner_timeout_at timestamptz;

alter table public.owner_reservation_requests
  drop constraint if exists owner_reservation_requests_status_check;

alter table public.owner_reservation_requests
  add constraint owner_reservation_requests_status_check
  check (
    status in (
      'pending_send',
      'initial_sent',
      'failed',
      'cancelled',
      'reminder_sent',
      'available_confirmed',
      'unavailable_confirmed',
      'needs_review',
      'expired_unavailable'
    )
  );
