-- ============================================
-- Sobukhazi v14 — Fees, Admissions, AI Analyses
-- Idempotent, Production Clean, Configurable
-- Run in Supabase SQL Editor
-- ============================================

create extension if not exists "pgcrypto";

-- Update function for updated_at
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- =====================
-- FEES — Configurable by Bursar
-- =====================

-- Fee Structures — Bursar sets per Form per Term
create table if not exists public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  form_name text not null, -- e.g. "Form 1", "1A", "4A"
  term text not null check (term in ('Term 1','Term 2','Term 3')),
  year int not null default 2026,
  tuition_usd numeric not null default 0,
  levies_usd numeric not null default 0, -- sports, building, exam etc
  total_usd numeric generated always as (tuition_usd + levies_usd) stored,
  exchange_rate numeric not null default 26.5, -- 1 USD = ZiG
  total_zig numeric generated always as ((tuition_usd + levies_usd) * exchange_rate) stored,
  description text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_slug, form_name, term, year)
);
create index if not exists idx_fee_struct_project on public.fee_structures(project_slug);
drop trigger if exists trg_fee_struct_updated on public.fee_structures;
create trigger trg_fee_struct_updated before update on public.fee_structures for each row execute function update_updated_at();

-- Invoices — Auto-generated per student per term
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  student_id uuid references public.students(id) on delete set null,
  student_name text not null,
  class_name text not null,
  form_name text,
  term text not null,
  year int not null default 2026,
  amount_usd numeric not null,
  amount_zig numeric,
  amount_due_usd numeric not null,
  amount_due_zig numeric,
  amount_paid_usd numeric not null default 0,
  amount_paid_zig numeric not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid','partial','paid','overdue','void')),
  due_date date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_invoices_project on public.invoices(project_slug);
create index if not exists idx_invoices_student on public.invoices(student_name);
create index if not exists idx_invoices_class on public.invoices(class_name);
create index if not exists idx_invoices_status on public.invoices(status);
drop trigger if exists trg_invoices_updated on public.invoices;
create trigger trg_invoices_updated before update on public.invoices for each row execute function update_updated_at();

-- Payments — Bursar records with reference
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  student_id uuid references public.students(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  student_name text not null,
  class_name text,
  amount numeric not null,
  currency text not null check (currency in ('USD','ZiG')) default 'USD',
  method text not null check (method in ('EcoCash USD','EcoCash ZiG','OneMoney','InnBucks','Bank Transfer USD','Bank Transfer ZiG','Cash USD','Cash ZiG','Paynow','Other')),
  reference_code text, -- EcoCash MP... or bank ref
  receipt_no text unique,
  paid_at date not null default CURRENT_DATE,
  recorded_by text,
  recorded_by_name text,
  notes text,
  voided boolean default false,
  void_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_payments_project on public.payments(project_slug);
create index if not exists idx_payments_student on public.payments(student_name);
create index if not exists idx_payments_receipt on public.payments(receipt_no);
create index if not exists idx_payments_ref on public.payments(reference_code);

-- =====================
-- ADMISSIONS — All Forms, Configurable Exam
-- =====================

create table if not exists public.admissions_applications (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  application_no text unique not null default ('SOB-APP-' || to_char(now(),'YYYY') || '-' || substr(gen_random_uuid()::text,1,6)),
  applicant_name text not null,
  dob date,
  gender text check (gender in ('M','F','Other')) default 'M',
  applying_form text not null, -- Form 1, 2A, 3B, 4A, 5A, 6A etc
  previous_school text,
  last_grade text,
  grade7_results jsonb, -- {maths: 75, english: 80, ...}
  olevel_results jsonb, -- for A-Level applicants
  parent_name text not null,
  parent_email text not null,
  parent_phone text,
  parent_id_no text,
  address text,
  reason_for_transfer text,
  -- Documents URLs (Supabase storage or base64)
  birth_cert_url text,
  report_url text,
  photo_url text,
  transfer_letter_url text,
  id_copy_url text,
  -- Status flow
  status text not null default 'pending_documents' check (status in ('pending_documents','documents_verified','exam_scheduled','exam_done','interview_scheduled','interview_done','accepted','waitlist','rejected','fees_paid','enrolled')),
  -- Verification
  verified_by text,
  verified_at timestamptz,
  verification_notes text,
  -- Decision
  decision_by text,
  decision_at timestamptz,
  decision_reason text,
  acceptance_letter_url text,
  -- Fees
  enrollment_fee_usd numeric default 100,
  enrollment_fee_paid boolean default false,
  -- Tracking
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_adm_project on public.admissions_applications(project_slug);
create index if not exists idx_adm_status on public.admissions_applications(status);
create index if not exists idx_adm_form on public.admissions_applications(applying_form);
create index if not exists idx_adm_parent on public.admissions_applications(parent_email);
drop trigger if exists trg_adm_updated on public.admissions_applications;
create trigger trg_adm_updated before update on public.admissions_applications for each row execute function update_updated_at();

-- Admission Exams — Configurable by Admin
create table if not exists public.admission_exams (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  application_id uuid references public.admissions_applications(id) on delete cascade,
  applicant_name text not null,
  applying_form text not null,
  exam_date date not null,
  exam_time time,
  venue text,
  -- Configurable subjects — Admin defines what subjects to test
  subjects_config jsonb not null default '[{"name":"Mathematics","max":100},{"name":"English","max":100},{"name":"General Paper","max":100}]'::jsonb,
  scores jsonb not null default '{}'::jsonb, -- {"Mathematics":78,"English":82}
  total_score int,
  max_score int,
  percentage numeric,
  result text check (result in ('pass','fail','pending')) default 'pending',
  examiner_name text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_adm_exam_project on public.admission_exams(project_slug);
create index if not exists idx_adm_exam_app on public.admission_exams(application_id);
drop trigger if exists trg_adm_exam_updated on public.admission_exams;
create trigger trg_adm_exam_updated before update on public.admission_exams for each row execute function update_updated_at();

-- Admission Interviews
create table if not exists public.admission_interviews (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  application_id uuid references public.admissions_applications(id) on delete cascade,
  applicant_name text not null,
  interview_date date,
  interview_time time,
  interviewer_name text,
  score int,
  max_score int default 50,
  recommendation text check (recommendation in ('strongly_recommend','recommend','waitlist','not_recommend')) default 'recommend',
  notes text,
  created_at timestamptz not null default now()
);

-- =====================
-- AI ANALYSES — No Hallucination, Real Data Only
-- =====================

create table if not exists public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  student_id uuid references public.students(id) on delete set null,
  student_name text not null,
  class_name text not null,
  term text not null,
  year int not null default 2026,
  -- Real data snapshot used for analysis (to prove no hallucination)
  data_snapshot jsonb not null, -- {results: [...], late_count: 3, class_avg: 64, ...}
  -- AI output
  trend jsonb, -- {direction: improving, delta: +9, term1_avg: 62, term2_avg: 71}
  strengths jsonb, -- [{"subject":"Maths","score":85,"reason":"above class avg"}]
  weaknesses jsonb,
  risk_flags jsonb, -- ["8 late arrivals Mondays", "English drop -7%"]
  predicted_grades jsonb, -- {"Maths":"B","English":"D"}
  teacher_actions jsonb, -- ["Extra English 30min/week", ...]
  draft_comment text,
  parent_summary text,
  class_comparison jsonb, -- {avg: 64, position: 12, total: 45}
  -- Meta
  model_used text,
  prompt_version text default 'v1-no-hallucination',
  teacher_edited_comment text,
  is_edited boolean default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_slug, student_name, term, year)
);
create index if not exists idx_ai_project on public.ai_analyses(project_slug);
create index if not exists idx_ai_student on public.ai_analyses(student_name);
create index if not exists idx_ai_term on public.ai_analyses(term, year);
drop trigger if exists trg_ai_updated on public.ai_analyses;
create trigger trg_ai_updated before update on public.ai_analyses for each row execute function update_updated_at();

-- RLS disable for all new tables (same as existing)
alter table public.fee_structures disable row level security;
alter table public.invoices disable row level security;
alter table public.payments disable row level security;
alter table public.admissions_applications disable row level security;
alter table public.admission_exams disable row level security;
alter table public.admission_interviews disable row level security;
alter table public.ai_analyses disable row level security;

-- Policies for anon
do $$ begin
  drop policy if exists "allow all for anon" on public.fee_structures;
  create policy "allow all for anon" on public.fee_structures for all using (true) with check (true);
exception when others then null; end $$;
do $$ begin
  drop policy if exists "allow all for anon" on public.invoices;
  create policy "allow all for anon" on public.invoices for all using (true) with check (true);
exception when others then null; end $$;
do $$ begin
  drop policy if exists "allow all for anon" on public.payments;
  create policy "allow all for anon" on public.payments for all using (true) with check (true);
exception when others then null; end $$;
do $$ begin
  drop policy if exists "allow all for anon" on public.admissions_applications;
  create policy "allow all for anon" on public.admissions_applications for all using (true) with check (true);
exception when others then null; end $$;
do $$ begin
  drop policy if exists "allow all for anon" on public.admission_exams;
  create policy "allow all for anon" on public.admission_exams for all using (true) with check (true);
exception when others then null; end $$;
do $$ begin
  drop policy if exists "allow all for anon" on public.admission_interviews;
  create policy "allow all for anon" on public.admission_interviews for all using (true) with check (true);
exception when others then null; end $$;
do $$ begin
  drop policy if exists "allow all for anon" on public.ai_analyses;
  create policy "allow all for anon" on public.ai_analyses for all using (true) with check (true);
exception when others then null; end $$;

-- Disable again after policy creation
alter table public.fee_structures disable row level security;
alter table public.invoices disable row level security;
alter table public.payments disable row level security;
alter table public.admissions_applications disable row level security;
alter table public.admission_exams disable row level security;
alter table public.admission_interviews disable row level security;
alter table public.ai_analyses disable row level security;

-- Verify
select 'fee_structures' as table_name, count(*) from public.fee_structures where project_slug='sobukhazi-high-school'
union all select 'invoices', count(*) from public.invoices where project_slug='sobukhazi-high-school'
union all select 'payments', count(*) from public.payments where project_slug='sobukhazi-high-school'
union all select 'admissions_applications', count(*) from public.admissions_applications where project_slug='sobukhazi-high-school'
union all select 'admission_exams', count(*) from public.admission_exams where project_slug='sobukhazi-high-school'
union all select 'ai_analyses', count(*) from public.ai_analyses where project_slug='sobukhazi-high-school'
union all select 'students', count(*) from public.students where project_slug='sobukhazi-high-school'
union all select 'term_results', count(*) from public.term_results where project_slug='sobukhazi-high-school';
