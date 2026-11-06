-- Candy Auction: Supabase setup
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Running it again wipes everything and starts fresh (all candy back in the pool).

drop table if exists candy, cooldowns, auction, auction_players, bids, gamble_prizes, offers, activity cascade;

create table candy (
  id text primary key,
  name text not null,
  img text not null,
  sort int not null default 0,
  owner text,              -- null = still available
  won_how text,
  won_at timestamptz
);

create table cooldowns (
  username text not null,
  activity text not null check (activity in ('auction','gamble','offer')),
  done_at timestamptz not null default now(),
  primary key (username, activity)
);

create table auction (
  id int primary key default 1 check (id = 1),
  status text not null default 'closed' check (status in ('closed','lobby','picking','bidding')),
  lot text[] not null default '{}',
  round int not null default 0,
  best_bid bigint,
  last_result text,
  updated_at timestamptz not null default now()
);
insert into auction (id) values (1);

create table auction_players (
  username text primary key,
  joined_at timestamptz not null default now()
);

create table bids (
  id bigserial primary key,
  round int not null,
  username text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table gamble_prizes (
  username text primary key,
  candy_ids text[] not null default '{}'
);

create table offers (
  username text not null,
  slot int not null check (slot between 1 and 3),
  candy_ids text[] not null default '{}',
  primary key (username, slot)
);

create table activity (
  id bigserial primary key,
  username text,
  message text not null,
  needs_action boolean not null default false,
  created_at timestamptz not null default now()
);

insert into candy (id, name, img, sort) values
  ('kitkat-1', 'Kit Kat', 'kitkat.jpg', 1),
  ('kitkat-2', 'Kit Kat', 'kitkat.jpg', 2),
  ('kitkat-3', 'Kit Kat', 'kitkat.jpg', 3),
  ('reeses-1', 'Reese''s Cups', 'reeses.jpg', 4),
  ('reeses-2', 'Reese''s Cups', 'reeses.jpg', 5),
  ('reeses-3', 'Reese''s Cups', 'reeses.jpg', 6),
  ('snickers-1', 'Snickers', 'snickers.jpg', 7),
  ('snickers-2', 'Snickers', 'snickers.jpg', 8),
  ('snickers-3', 'Snickers', 'snickers.jpg', 9),
  ('snickers-4', 'Snickers', 'snickers.jpg', 10),
  ('snickers-5', 'Snickers', 'snickers.jpg', 11),
  ('snickers-6', 'Snickers', 'snickers.jpg', 12),
  ('milkyway-1', 'Milky Way', 'milkyway.jpg', 13),
  ('milkyway-2', 'Milky Way', 'milkyway.jpg', 14),
  ('twix', 'Twix', 'twix.jpg', 15),
  ('twix_mini', 'Twix (Left) mini', 'twix_mini.jpg', 16),
  ('mms', 'M&M''s', 'mms.jpg', 17),
  ('three_musketeers', '3 Musketeers', 'three_musketeers.jpg', 18),
  ('babyruth', 'Baby Ruth', 'babyruth.jpg', 19),
  ('hersheys', 'Hershey''s Special Dark', 'hersheys.jpg', 20),
  ('whoppers', 'Whoppers', 'whoppers.jpg', 21),
  ('unreal', 'Unreal Dark Chocolate Coconut', 'unreal.jpg', 22),
  ('rkt-1', 'Rice Krispies Treat', 'rkt.jpg', 23),
  ('rkt-2', 'Rice Krispies Treat', 'rkt.jpg', 24),
  ('starburst_2pk-1', 'Starburst (2-pack)', 'starburst_2pk.jpg', 25),
  ('starburst_2pk-2', 'Starburst (2-pack)', 'starburst_2pk.jpg', 26),
  ('starburst_yellow', 'Starburst (yellow)', 'starburst_yellow.jpg', 27),
  ('starburst_orange', 'Starburst (orange)', 'starburst_orange.jpg', 28),
  ('welchs-1', 'Welch''s Fruit Snacks', 'welchs.jpg', 29),
  ('welchs-2', 'Welch''s Fruit Snacks', 'welchs.jpg', 30),
  ('welchs-3', 'Welch''s Fruit Snacks', 'welchs.jpg', 31),
  ('airheads_grape', 'Airheads (grape)', 'airheads_grape.jpg', 32),
  ('airheads_watermelon', 'Airheads (watermelon)', 'airheads_watermelon.jpg', 33),
  ('airheads_sour', 'Airheads (sour)', 'airheads_sour.jpg', 34),
  ('airheads_mystery', 'Airheads Mystery', 'airheads_mystery.jpg', 35),
  ('swedish_mini', 'Swedish Fish mini bag', 'swedish_mini.jpg', 36),
  ('swedish_single', 'Swedish Fish (single)', 'swedish_single.jpg', 37),
  ('hichew_apple', 'Hi-Chew (apple)', 'hichew_apple.jpg', 38),
  ('hichew_strawberry', 'Hi-Chew (strawberry)', 'hichew_strawberry.jpg', 39),
  ('twizzlers', 'Twizzlers', 'twizzlers.jpg', 40),
  ('jr_gummies', 'Jolly Rancher Gummies mini', 'jr_gummies.jpg', 41),
  ('haribo', 'Haribo Twin Snakes mini', 'haribo.jpg', 42),
  ('ringpop', 'Ring Pop Sour', 'ringpop.jpg', 43),
  ('lolli1', 'Lollipop', 'lolli1.jpg', 44),
  ('lolli2', 'Lollipop', 'lolli2.jpg', 45),
  ('lolli3', 'Lollipop', 'lolli3.jpg', 46),
  ('lolli4', 'Lollipop', 'lolli4.jpg', 47),
  ('lolli5', 'Lollipop', 'lolli5.jpg', 48),
  ('lolli6', 'Lollipop', 'lolli6.jpg', 49),
  ('lolli7', 'Lollipop', 'lolli7.jpg', 50),
  ('lolli8', 'Lollipop', 'lolli8.jpg', 51),
  ('lolli9', 'Lollipop', 'lolli9.jpg', 52),
  ('lolli10', 'Lollipop', 'lolli10.jpg', 53),
  ('lolli11', 'Lollipop', 'lolli11.jpg', 54);

-- Let the website read and write these tables.
do $$
declare t text;
begin
  foreach t in array array['candy','cooldowns','auction','auction_players','bids','gamble_prizes','offers','activity'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "site access" on %I', t);
    execute format('create policy "site access" on %I for all to anon, authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
    execute format('alter publication supabase_realtime add table %I', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to anon, authenticated;
