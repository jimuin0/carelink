#!/usr/bin/env node
/**
 * .env.example に実値（秘密情報のパターン）が混入していないかチェック
 * pre-commit で実行され、検知時は commit を中止する
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.cwd(), '.env.example');
if (!fs.existsSync(FILE)) process.exit(0);

const txt = fs.readFileSync(FILE, 'utf8');

const PATTERNS = [
  // Slack Webhook（本物パターン: TXXXXXXXX/BXXXXXXXX/<24+ 英数>）
  { name: 'Slack Webhook URL', re: /hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/ },
  // Stripe 秘密鍵
  { name: 'Stripe secret key', re: /\bsk_live_[A-Za-z0-9]{20,}/ },
  { name: 'Stripe restricted key', re: /\brk_live_[A-Za-z0-9]{20,}/ },
  // Resend
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{20,}/ },
  // Supabase / 一般 JWT（3 セグメント Base64）
  { name: 'JWT token (likely Supabase service_role/anon)', re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  // GitHub fine-grained PAT
  { name: 'GitHub PAT', re: /\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  // OpenAI / Anthropic
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  // AWS
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  // Upstash REST トークン（Base64 URL、長め）
  { name: 'Upstash REST token (likely)', re: /\b[A-Za-z0-9_-]{60,}={0,2}\b(?=.*upstash)/i },
];

const lines = txt.split('\n');
const hits = [];
for (let i = 0; i < lines.length; i++) {
  for (const p of PATTERNS) {
    if (p.re.test(lines[i])) {
      hits.push({ line: i + 1, name: p.name, content: lines[i].replace(/=.*/, '=****REDACTED****') });
    }
  }
}

if (hits.length > 0) {
  console.error('🔴 .env.example に実値（秘密情報）が混入しています:\n');
  for (const h of hits) {
    console.error(`  L${h.line}  [${h.name}]`);
    console.error(`         ${h.content}`);
  }
  console.error('\n対処: 該当行の値をプレースホルダ（例: your_xxx_here / REDACTED）に置換してから再コミット');
  process.exit(1);
}
process.exit(0);
