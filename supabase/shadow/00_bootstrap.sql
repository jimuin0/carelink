-- Supabase 互換の最小 bootstrap（shadow DB 専用・本番には絶対に適用しない）。
-- migration が前提とする「Supabase が最初から用意しているもの」だけを再現する。
-- ここに業務テーブルを 1 つも作らないこと（作ると期待スキーマが汚染され、
-- 本番との diff が「migration の内容」ではなくなる）。

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin LOGIN SUPERUSER; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS graphql_public;

-- auth.users は migration から FK 参照される（実測 54 箇所が id を参照）。
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text,
  phone              text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
  created_at         timestamptz DEFAULT now()
);

-- RLS ポリシー本文が呼ぶ関数群。実行時の値は shadow では不要なので NULL を返す。
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;

-- 実 Supabase の storage.buckets / storage.objects の列構成に合わせる。
-- ⚠️ 列を削ると migration の ALTER が「列が無い」で落ち、それを migration の欠陥と
--    誤認する（実際に file_size_limit の欠落で 1 本落ちた）。実物に揃えること。
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  owner_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  user_metadata jsonb,
  version text
);

-- Supabase は既定でこの publication を持つ。ALTER PUBLICATION ... ADD TABLE が
-- migration にあるため、無いと落ちる（実測で 1 本落ちた）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(name, '.', -1) $$;

GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;

-- 🔴 Supabase の既定権限を再現する（2026年8月2日・実測で判明）。
--   Supabase は新規プロジェクトで
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role
--   を設定しており、**public の全テーブルに 3 ロール分の GRANT が自動で付く**。
--   これを bootstrap に入れないと、shadow 側は migration が明示 GRANT した数本しか
--   持たず、本番との突合で **全テーブルの grant 行が差分**になる＝大量の誤報になる。
--   実測(soel 本番・56 テーブル): grant 行 168 = 56 × 3 ロール。shadow は 16 しか無かった。
--   ⚠️ ALTER DEFAULT PRIVILEGES は【この文より後に作られる】テーブルにだけ効く。
--     bootstrap は migration より前に走るので、全業務テーブルが対象になる（順序が本質）。
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
