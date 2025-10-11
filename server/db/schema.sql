-- Undervalued Estate - Supabase Schema
-- Run this in the Supabase SQL editor

-- Ensure required extensions
create extension if not exists pgcrypto;

-- =========================
-- Enums
-- =========================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'property_type_enum') then
    create type property_type_enum as enum ('house', 'apartment', 'condo', 'townhouse', 'land', 'duplex', 'studio', 'other');
  end if;
end$$;

-- If upgrading an existing database, ensure url_canonical/first_seen_at/last_seen_at exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'url_canonical'
  ) then
    alter table public.properties add column url_canonical text;
    create index if not exists idx_properties_url_canonical on public.properties (url_canonical);
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'first_seen_at'
  ) then
    alter table public.properties add column first_seen_at timestamptz not null default now();
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'last_seen_at'
  ) then
    alter table public.properties add column last_seen_at timestamptz;
    create index if not exists idx_properties_last_seen_at on public.properties (last_seen_at desc);
  end if;
end$$;

-- =========================
-- Rent Benchmarks (Materialized View)
-- =========================
-- Similar to current_benchmarks but filtered to rent listings
do $$
begin
  if not exists (select 1 from pg_matviews where matviewname = 'current_rent_benchmarks') then
    create materialized view public.current_rent_benchmarks as
    with ranked as (
      select
        country, state, city, neighborhood, property_type, currency,
        now()::date as computed_on,
        round(avg(price_per_sqm)::numeric, 2) as avg_price_per_sqm,
        round(percentile_cont(0.25) within group (order by price_per_sqm)::numeric, 2) as p25_price_per_sqm,
        round(percentile_cont(0.50) within group (order by price_per_sqm)::numeric, 2) as p50_price_per_sqm,
        round(percentile_cont(0.75) within group (order by price_per_sqm)::numeric, 2) as p75_price_per_sqm,
        count(*)::int as sample_count,
        row_number() over (
          partition by country, state, city, neighborhood, property_type, currency
          order by now() desc
        ) as rn
      from public.properties
      where is_active = true
        and listing_type = 'rent'::property_listing_type_enum
        and price_per_sqm is not null
      group by country, state, city, neighborhood, property_type, currency
    )
    select * from ranked where rn = 1;
  else
    refresh materialized view public.current_rent_benchmarks;
  end if;
end$$;

create index if not exists idx_current_rent_benchmarks_area on public.current_rent_benchmarks (country, state, city, neighborhood);
create index if not exists idx_current_rent_benchmarks_type on public.current_rent_benchmarks (property_type);

-- =========================
-- Run Locks: simple distributed lock for worker fan-out
-- =========================
create table if not exists public.run_locks (
  lock_key text primary key,
  locked_until timestamptz not null,
  owner text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'deal_class_enum') then
    create type deal_class_enum as enum ('none', 'slightly_undervalued', 'strongly_undervalued', 'rare_deal');
  end if;
end$$;

-- Listing type enum: buy vs rent
do $$
begin
  if not exists (select 1 from pg_type where typname = 'property_listing_type_enum') then
    create type property_listing_type_enum as enum ('buy', 'rent');
  end if;
end$$;

-- =========================
-- Utility Tables
-- =========================
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  created_at timestamptz not null default now(),
  unique(name)
);

-- =========================
-- Core: Properties (scraped)
-- =========================
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text not null,
  url text not null,
  url_canonical text,

  title text,
  description text,
  price numeric(16,2) not null,
  currency text not null default 'NGN',
  size_sqm numeric(10,2),
  bedrooms int,
  bathrooms int,
  property_type property_type_enum not null,

  address_line1 text,
  address_line2 text,
  neighborhood text,
  city text,
  state text,
  postal_code text,
  country text,

  latitude double precision,
  longitude double precision,

  year_built int,
  lot_size_sqm numeric(12,2),

  listed_at timestamptz,
  listing_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  scraped_at timestamptz not null default now(),
  is_active boolean not null default true,

  raw jsonb,

  listing_type property_listing_type_enum not null default 'buy',

  price_per_sqm numeric(18,2) generated always as
    (case when size_sqm is not null and size_sqm > 0 then round(price / size_sqm, 2) end) stored,

  unique (source_id, external_id)
);

create index if not exists idx_properties_area on public.properties (country, state, city, neighborhood);
create index if not exists idx_properties_type on public.properties (property_type);
create index if not exists idx_properties_price on public.properties (price);
create index if not exists idx_properties_price_per_sqm on public.properties (price_per_sqm);
create index if not exists idx_properties_scraped_at on public.properties (scraped_at desc);
create index if not exists idx_properties_listed_at on public.properties (listed_at desc);
create index if not exists idx_properties_listing_updated_at on public.properties (listing_updated_at desc);
create index if not exists idx_properties_url_canonical on public.properties (url_canonical);
create index if not exists idx_properties_last_seen_at on public.properties (last_seen_at desc);

-- If upgrading an existing database, ensure the listing_updated_at column exists
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'listing_updated_at'
  ) then
    alter table public.properties add column listing_updated_at timestamptz;
    create index if not exists idx_properties_listing_updated_at on public.properties (listing_updated_at desc);
  end if;
end$$;
create index if not exists idx_properties_active on public.properties (is_active);
create index if not exists idx_properties_geo on public.properties (latitude, longitude);
create index if not exists idx_properties_raw_gin on public.properties using gin (raw);

-- If upgrading an existing database, widen numeric precision to avoid overflows
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'price'
  ) then
    begin
      alter table public.properties alter column price type numeric(16,2);
    exception when others then null; -- ignore if already wider
    end;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'price_per_sqm'
  ) then
    begin
      alter table public.properties alter column price_per_sqm type numeric(18,2);
    exception when others then null; -- ignore if already wider
    end;
  end if;
end$$;

-- =========================
-- Benchmarks
-- =========================
create table if not exists public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  state text,
  city text,
  neighborhood text,
  property_type property_type_enum not null,
  currency text not null default 'NGN',

  computed_on date not null default (now()::date),

  avg_price_per_sqm numeric(12,2) not null,
  p25_price_per_sqm numeric(12,2),
  p50_price_per_sqm numeric(12,2),
  p75_price_per_sqm numeric(12,2),

  sample_count int not null,

  created_at timestamptz not null default now()
);

create index if not exists idx_benchmarks_area on public.benchmarks (country, state, city, neighborhood);
create index if not exists idx_benchmarks_type on public.benchmarks (property_type);
create index if not exists idx_benchmarks_computed on public.benchmarks (computed_on desc);

-- Ensure uniqueness per area/type/currency per computation date to avoid duplicates
create unique index if not exists ux_benchmarks_dim_time
  on public.benchmarks (country, state, city, neighborhood, property_type, currency, computed_on);

-- =========================
-- Alerts
-- =========================
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  country text not null,
  state text,
  city text,
  neighborhood text,
  property_type property_type_enum,
  threshold_percent numeric(5,2) not null,
  min_price numeric(12,2),
  max_price numeric(12,2),
  min_size_sqm numeric(10,2),
  max_size_sqm numeric(10,2),

  email text not null,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_alerts_user on public.alerts (user_id);
create index if not exists idx_alerts_area on public.alerts (country, state, city, neighborhood);
create index if not exists idx_alerts_active on public.alerts (is_active);

-- updated_at trigger helper
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'set_current_timestamp_updated_at') then
    create or replace function public.set_current_timestamp_updated_at()
    returns trigger as $func$
    begin
      new.updated_at = now();
      return new;
    end;
    $func$ language plpgsql;
  end if;
end$$;

-- Recreate trigger idempotently (CREATE TRIGGER has no IF NOT EXISTS)
drop trigger if exists trg_alerts_updated_at on public.alerts;
create trigger trg_alerts_updated_at
before update on public.alerts
for each row execute procedure public.set_current_timestamp_updated_at();

-- =========================
-- Notifications
-- =========================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  sent_at timestamptz not null default now(),
  status text not null default 'sent',
  error text,

  unique(alert_id, property_id)
);

create index if not exists idx_notifications_alert on public.notifications (alert_id);
create index if not exists idx_notifications_property on public.notifications (property_id);

-- =========================
-- Optional: User Profiles
-- =========================
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  default_country text,
  default_city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Recreate trigger idempotently
drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute procedure public.set_current_timestamp_updated_at();

-- =========================
-- RLS (Row-Level Security)
-- =========================
alter table public.properties enable row level security;
alter table public.benchmarks enable row level security;
alter table public.alerts enable row level security;
alter table public.notifications enable row level security;
alter table public.user_profiles enable row level security;
alter table public.sources enable row level security;

drop policy if exists "public read properties" on public.properties;
create policy "public read properties" on public.properties
for select using (true);
drop policy if exists "ingest with service role only" on public.properties;
create policy "ingest with service role only" on public.properties
for all to authenticated using (false) with check (false);

drop policy if exists "public read benchmarks" on public.benchmarks;
create policy "public read benchmarks" on public.benchmarks
for select using (true);
drop policy if exists "server writes benchmarks" on public.benchmarks;
create policy "server writes benchmarks" on public.benchmarks
for all to authenticated using (false) with check (false);

drop policy if exists "public read sources" on public.sources;
create policy "public read sources" on public.sources
for select using (true);
drop policy if exists "server writes sources" on public.sources;
create policy "server writes sources" on public.sources
for all to authenticated using (false) with check (false);

drop policy if exists "users can select own alerts" on public.alerts;
create policy "users can select own alerts" on public.alerts
for select using (auth.uid() = user_id);
drop policy if exists "users can insert own alerts" on public.alerts;
create policy "users can insert own alerts" on public.alerts
for insert with check (auth.uid() = user_id);
drop policy if exists "users can update own alerts" on public.alerts;
create policy "users can update own alerts" on public.alerts
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users can delete own alerts" on public.alerts;
create policy "users can delete own alerts" on public.alerts
for delete using (auth.uid() = user_id);

drop policy if exists "users see notifications via their alerts" on public.notifications;
create policy "users see notifications via their alerts" on public.notifications
for select using (exists (
  select 1 from public.alerts a
  where a.id = notifications.alert_id and a.user_id = auth.uid()
));

drop policy if exists "users select own profile" on public.user_profiles;
create policy "users select own profile" on public.user_profiles
for select using (auth.uid() = user_id);
drop policy if exists "users upsert own profile" on public.user_profiles;
create policy "users upsert own profile" on public.user_profiles
for insert with check (auth.uid() = user_id);
drop policy if exists "users update own profile" on public.user_profiles;
create policy "users update own profile" on public.user_profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================
-- Views and Materialized Views
-- =========================
-- CREATE MATERIALIZED VIEW lacks IF NOT EXISTS; guard with DO block
do $$
begin
  if not exists (
    select 1 from pg_matviews where schemaname = 'public' and matviewname = 'current_benchmarks'
  ) then
    create materialized view public.current_benchmarks as
    with ranked as (
      select
        b.*,
        row_number() over (
          partition by country, state, city, neighborhood, property_type, currency
          order by computed_on desc, created_at desc
        ) as rn
      from public.benchmarks b
    )
    select * from ranked where rn = 1;
  end if;
end$$;

create index if not exists idx_current_benchmarks_area on public.current_benchmarks (country, state, city, neighborhood);
create index if not exists idx_current_benchmarks_type on public.current_benchmarks (property_type);

create or replace view public.v_properties_with_deal as
select
  p.*,
  cb.avg_price_per_sqm as market_avg_price_per_sqm,
  case
    when p.price_per_sqm is not null and cb.avg_price_per_sqm is not null and cb.avg_price_per_sqm > 0
      then round( (p.price_per_sqm - cb.avg_price_per_sqm) / cb.avg_price_per_sqm * 100.0, 2)
  end as pct_vs_market,
  case
    when p.price_per_sqm is null or cb.avg_price_per_sqm is null or cb.avg_price_per_sqm = 0 then 'none'::deal_class_enum
    else (
      case
        when (p.price_per_sqm <= cb.avg_price_per_sqm * 0.80) then 'rare_deal'::deal_class_enum
        when (p.price_per_sqm <= cb.avg_price_per_sqm * 0.90) then 'strongly_undervalued'::deal_class_enum
        when (p.price_per_sqm <= cb.avg_price_per_sqm * 0.95) then 'slightly_undervalued'::deal_class_enum
        else 'none'::deal_class_enum
      end
    )
  end as deal_class
from public.properties p
left join public.current_benchmarks cb
  on cb.country = coalesce(p.country, cb.country)
 and coalesce(cb.state, '') = coalesce(p.state, '')
 and coalesce(cb.city, '') = coalesce(p.city, '')
 and coalesce(cb.neighborhood, '') = coalesce(p.neighborhood, '')
 and cb.property_type = p.property_type;

-- Recreate v_search_results to append new columns without renaming existing ones
drop view if exists public.v_search_results;
create view public.v_search_results as
select
  p.id,
  p.url,
  p.title,
  p.address_line1,
  p.price,
  p.currency,
  p.size_sqm,
  p.price_per_sqm,
  p.property_type,
  p.neighborhood, p.city, p.state, p.country,
  p.bedrooms, p.bathrooms,
  p.listed_at, p.listing_updated_at, p.scraped_at,
  v.market_avg_price_per_sqm,
  v.pct_vs_market,
  v.deal_class,
  rb.avg_price_per_sqm as rent_avg_price_per_sqm,
  case
    when p.listing_type = 'buy'::property_listing_type_enum
         and p.size_sqm is not null and p.size_sqm > 0
         and rb.avg_price_per_sqm is not null and p.price > 0
      then round( (rb.avg_price_per_sqm * p.size_sqm * 12.0) / nullif(p.price,0) * 100.0, 2)
  end as est_gross_yield_percent,
  p.listing_type
from public.properties p
join public.v_properties_with_deal v on v.id = p.id
left join public.current_rent_benchmarks rb
  on rb.country = coalesce(p.country, rb.country)
 and coalesce(rb.state, '') = coalesce(p.state, '')
 and coalesce(rb.city, '') = coalesce(p.city, '')
 and coalesce(rb.neighborhood, '') = coalesce(p.neighborhood, '')
 and rb.property_type = p.property_type
where p.is_active = true;

grant select on public.current_benchmarks to anon, authenticated;
grant select on public.v_properties_with_deal to anon, authenticated;
grant select on public.v_search_results to anon, authenticated;

-- =========================
-- Crawl State: per-region/page tuning
-- =========================
create table if not exists public.crawl_state (
  adapter_name text not null,
  region text not null,
  target_max_pages int not null default 1,
  last_discovered int,
  last_inserted int,
  low_yield_streak int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (adapter_name, region)
);

-- =========================
-- Benchmark Refresh Function
-- =========================
create or replace function public.refresh_benchmarks(target_country text default null,
                                                     target_state text default null,
                                                     target_city text default null,
                                                     target_neighborhood text default null,
                                                     target_property_type property_type_enum default null)
returns void
language plpgsql
as $$
begin
  insert into public.benchmarks (
    country, state, city, neighborhood, property_type, currency,
    computed_on,
    avg_price_per_sqm, p25_price_per_sqm, p50_price_per_sqm, p75_price_per_sqm,
    sample_count
  )
  select
    country,
    state,
    city,
    neighborhood,
    property_type,
    currency,
    now()::date as computed_on,
    round(avg(price_per_sqm)::numeric, 2) as avg_ppsqm,
    round(percentile_cont(0.25) within group (order by price_per_sqm)::numeric, 2) as p25,
    round(percentile_cont(0.50) within group (order by price_per_sqm)::numeric, 2) as p50,
    round(percentile_cont(0.75) within group (order by price_per_sqm)::numeric, 2) as p75,
    count(*)::int as sample_count
  from public.properties
  where is_active = true
    and price_per_sqm is not null
    and (target_country is null or country = target_country)
    and (target_state is null or state = target_state)
    and (target_city is null or city = target_city)
    and (target_neighborhood is null or neighborhood = target_neighborhood)
    and (target_property_type is null or property_type = target_property_type)
  group by country, state, city, neighborhood, property_type, currency
  on conflict (country, state, city, neighborhood, property_type, currency, computed_on)
  do update set
    avg_price_per_sqm = excluded.avg_price_per_sqm,
    p25_price_per_sqm = excluded.p25_price_per_sqm,
    p50_price_per_sqm = excluded.p50_price_per_sqm,
    p75_price_per_sqm = excluded.p75_price_per_sqm,
    sample_count = excluded.sample_count;

  begin
    refresh materialized view concurrently public.current_benchmarks;
  exception when feature_not_supported then
    refresh materialized view public.current_benchmarks;
  end;
end
$$;

-- =========================
-- Scraper Operational Tables (Cursors & Run History)
-- =========================

-- Discovery cursors: resume page-by-page progress per seed URL
create table if not exists public.discovery_cursors (
  seed_url text primary key,
  next_page int not null default 1,
  last_run_at timestamptz,
  last_status text
);

-- Scheduled run history for observability
create table if not exists public.scheduled_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  region text,
  adapter text,
  discovered int not null default 0,
  inserted int not null default 0,
  errors int not null default 0,
  raw jsonb
);

-- Idempotent unique index for deduplication safety (also enforced by unique constraint)
create unique index if not exists idx_properties_source_external
on public.properties (source_id, external_id);

