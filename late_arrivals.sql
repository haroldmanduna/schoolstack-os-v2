-- Late Arrivals System — Teacher marks late + time, parent gets auto notification
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/hsckgramsgokjtvcymhv/sql/new

-- Late arrivals table
create table if not exists public.late_arrivals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.school_profiles(id) on delete set null,
  student_name text not null, -- denormalized for quick display, real would be FK to students
  class_name text,
  date date not null default current_date,
  arrival_time time not null default current_time,
  marked_by uuid references public.projects(id) on delete set null, -- teacher id, simplified
  marked_by_name text, -- teacher name
  reason text check (reason in ('traffic','illness','family','transport','overslept','other','')),
  reason_details text,
  notified_parent boolean not null default false,
  notification_method text[] default array['portal'], -- portal, sms, whatsapp
  notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_late_student on public.late_arrivals(student_id);
create index if not exists idx_late_date on public.late_arrivals(date desc);
create index if not exists idx_late_class on public.late_arrivals(class_name);
create index if not exists idx_late_student_date on public.late_arrivals(student_name, date desc);
drop trigger if exists trg_late_updated on public.late_arrivals;
create trigger trg_late_updated before update on public.late_arrivals for each row execute function update_updated_at();

-- Parent notifications table (for late arrivals + other)
create table if not exists public.parent_notifications (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  parent_id text, -- parent identifier, simplified
  type text not null check (type in ('late_arrival','absence','fee_due','result_published','announcement','homework')),
  title text not null,
  message text not null,
  data jsonb default '{}'::jsonb, -- contains late_arrival details, etc.
  channel text[] default array['portal'], -- portal, sms, whatsapp
  read boolean not null default false,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_student on public.parent_notifications(student_name);
create index if not exists idx_notif_type on public.parent_notifications(type);
create index if not exists idx_notif_sent on public.parent_notifications(sent_at desc);

-- Disable RLS for agency OS
alter table public.late_arrivals disable row level security;
alter table public.parent_notifications disable row level security;

drop policy if exists "allow all for anon" on public.late_arrivals;
create policy "allow all for anon" on public.late_arrivals for all using (true) with check (true);
drop policy if exists "allow all for anon" on public.parent_notifications;
create policy "allow all for anon" on public.parent_notifications for all using (true) with check (true);

alter table public.late_arrivals disable row level security;
alter table public.parent_notifications disable row level security;

-- Seed example late arrivals
insert into public.late_arrivals (student_name, class_name, date, arrival_time, marked_by_name, reason, reason_details, notified_parent, notification_method)
values
('Tariro Dube', '5B', current_date, '08:23:00', 'Mr Ncube', 'traffic', 'Kumalo road traffic', true, array['portal','sms']),
('Kudzai Dube', '2A', current_date - 1, '08:45:00', 'Mrs Moyo', 'transport', 'Bus delayed', true, array['portal','whatsapp']),
('Student_001', '5B', current_date - 2, '08:15:00', 'Mr Ncube', 'overslept', '', true, array['portal'])
on conflict do nothing;

insert into public.parent_notifications (student_name, type, title, message, data, channel)
values
('Tariro Dube', 'late_arrival', 'Late arrival: Tariro arrived at 08:23', 'Tariro Dube (5B) arrived late today at 08:23. Reason: traffic (Kumalo road traffic). Marked by Mr Ncube.', '{"arrival_time":"08:23","reason":"traffic","teacher":"Mr Ncube","class":"5B"}'::jsonb, array['portal','sms']),
('Kudzai Dube', 'late_arrival', 'Late arrival: Kudzai arrived at 08:45', 'Kudzai Dube (2A) arrived late yesterday at 08:45. Reason: transport (Bus delayed).', '{"arrival_time":"08:45","reason":"transport","teacher":"Mrs Moyo","class":"2A"}'::jsonb, array['portal','whatsapp'])
on conflict do nothing;

select 'Late arrivals system ready — 2 tables, indexes, seed data' as status;
