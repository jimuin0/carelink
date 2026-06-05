# ADR-0003: handle_new_user trigger の Google OAuth 対応
Date: 2026-05-24
Status: Accepted

## Context
神原さんが Google OAuth (HAL 本店アカウント) で carelink にログインしたところ、アバターが「ユ」表示、マイページが「ユーザーさん、こんにちは」となり、プロフィール編集で名前を入力して保存しようとすると「サーバーエラーが発生しました」となる状態だった（実際の 500 原因は ADR-0002 の Upstash 障害だが、表示名空欄問題はそれとは独立）。

根本原因: `handle_new_user` トリガが `INSERT INTO profiles (id, display_name, email) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', ''), NEW.email)` と書かれており、Google OAuth が `raw_user_meta_data` に入れる `name` / `full_name` / `picture` を一切拾えていなかった。結果として profile.display_name = '' で作成され、UI フォールバックの「ユーザー」が表示されていた。

## Decision
1. トリガを修正し COALESCE フォールバック順を `display_name → full_name → name → email先頭 → ''` に変更
2. avatar_url も `raw_user_meta_data->>'avatar_url'` から拾う
3. 既存ユーザーをバックフィル（profile.display_name が空の行を auth.users.raw_user_meta_data から補完）

```sql
INSERT INTO profiles (id, display_name, email, avatar_url)
VALUES (
  NEW.id,
  COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    ''
  ),
  NEW.email,
  NULLIF(NEW.raw_user_meta_data->>'avatar_url', '')
);
```

加えてフロント側 4 箇所 (`AuthButton.tsx` / `HomeUserPanel.tsx` / `BookingFlow.tsx` / `mypage/page.tsx`) も同じフォールバック順に統一。

## Consequences
良い点:
- Google OAuth ユーザーも初回サインアップ時から正しい表示名・アバターが付く
- メール (Supabase password 認証) のみの既存挙動は壊さない
- 既存ユーザーは migration 適用時に自動補完

悪い点:
- メール先頭フォールバックは個人情報が UI に出る軽い懸念（プロフィール編集で上書き可能なため許容）

残る課題:
- LINE / Apple 等他 OAuth provider 追加時に同じパターンを追加要

## Alternatives
1. **トリガ変更せず、アプリ層で表示時にフォールバック**: 既存 4 箇所のフロント修正のみだと profile.display_name 空のまま DB に残り、CSV 出力等で「空」と表示される問題は残るため不採用。
2. **OAuth provider 毎に別テーブル**: 過剰設計。

## References
- Migration: `supabase/migrations/20260524000002_oauth_displayname.sql`
- フロント修正: `src/components/auth/AuthButton.tsx:58-67`, `src/components/search/HomeUserPanel.tsx:60-68`, `src/components/booking/BookingFlow.tsx:38-46`, `src/app/mypage/page.tsx:25`
- 別件で audit_logs 統合も同時実施: `supabase/migrations/20260524000001_audit_signup_salon.sql`
