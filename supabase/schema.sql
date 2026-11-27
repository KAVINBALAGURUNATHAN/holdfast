-- HoldFast schema (Supabase / Postgres). Run in the Supabase SQL editor.
-- The backend connects with the service-role key, so RLS is enabled with no public policies.

create extension if not exists "pgcrypto";

create table if not exists contracts (
    id            uuid primary key default gen_random_uuid(),
    title         text not null,
    status        text not null default 'draft' check (status in ('draft', 'active', 'completed')),
    raw_text      text not null default '',
    parties       jsonb not null default '[]'::jsonb,
    currency      text not null default 'INR',
    total_amount  numeric(14, 2) not null default 0,
    created_at    timestamptz not null default now()
);

create table if not exists milestones (
    id                       uuid primary key default gen_random_uuid(),
    contract_id              uuid not null references contracts(id) on delete cascade,
    seq                      integer not null,
    title                    text not null,
    description              text not null default '',
    acceptance_criteria      jsonb not null default '[]'::jsonb,
    amount                   numeric(14, 2) not null default 0,
    due_date                 date,
    status                   text not null default 'pending'
                             check (status in ('pending', 'funded', 'submitted', 'approved', 'rejected', 'released', 'held')),
    escrow_order_id          text,
    escrow_authorization_id  text,   -- internal; never returned by the API
    unique (contract_id, seq)
);

create table if not exists submissions (
    id              uuid primary key default gen_random_uuid(),
    milestone_id    uuid not null references milestones(id) on delete cascade,
    notes           text not null default '',
    file_name       text,
    extracted_text  text not null default '',
    created_at      timestamptz not null default now()
);

create table if not exists verdicts (
    id                uuid primary key default gen_random_uuid(),
    submission_id     uuid not null unique references submissions(id) on delete cascade,
    decision          text not null check (decision in ('approve', 'reject', 'needs_review')),
    confidence        double precision not null check (confidence >= 0 and confidence <= 1),
    reasoning         text not null,
    criteria_results  jsonb not null default '[]'::jsonb,
    created_at        timestamptz not null default now()
);

create table if not exists approvals (
    id                  uuid primary key default gen_random_uuid(),
    milestone_id        uuid not null references milestones(id) on delete cascade,
    action              text not null check (action in ('release', 'hold', 'refund')),
    requested_by_agent  text not null,
    reason              text not null,
    status              text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
    decided_by          text,
    decided_at          timestamptz,
    created_at          timestamptz not null default now()
);

create table if not exists audit_events (
    id            uuid primary key default gen_random_uuid(),
    seq           bigint generated always as identity,  -- tie-breaker for newest-first ordering
    contract_id   uuid not null references contracts(id) on delete cascade,
    milestone_id  uuid references milestones(id) on delete set null,
    actor         text not null,
    action        text not null,
    details       jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create index if not exists idx_contracts_created_at   on contracts (created_at desc);
create index if not exists idx_milestones_contract    on milestones (contract_id, seq);
create index if not exists idx_submissions_milestone  on submissions (milestone_id, created_at desc);
create index if not exists idx_approvals_status       on approvals (status, created_at desc);
create index if not exists idx_approvals_milestone    on approvals (milestone_id);
create index if not exists idx_audit_contract_created on audit_events (contract_id, created_at desc, seq desc);

-- Audit trail is append-only.
create or replace function holdfast_audit_immutable() returns trigger language plpgsql as $$
begin
    raise exception 'audit_events is append-only';
end;
$$;
drop trigger if exists audit_events_no_update on audit_events;
create trigger audit_events_no_update before update on audit_events
    for each row execute function holdfast_audit_immutable();

alter table contracts    enable row level security;
alter table milestones   enable row level security;
alter table submissions  enable row level security;
alter table verdicts     enable row level security;
alter table approvals    enable row level security;
alter table audit_events enable row level security;

-- Lock the tables to the server. The backend uses the service-role / secret key,
-- which bypasses RLS; with RLS on and no policies, the public (anon/publishable)
-- key cannot read or write anything.
alter table contracts    enable row level security;
alter table milestones   enable row level security;
alter table submissions  enable row level security;
alter table verdicts     enable row level security;
alter table approvals    enable row level security;
alter table audit_events enable row level security;
