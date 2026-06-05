import { NextResponse } from 'next/server';

// 未マッチの /api/* パスは 404 JSON を返す（既定では app シェル HTML が 200 で返り、
// 「存在しない API が 200」「ハンドラ未定義の動的パスが 200」になっていた）。
// より具体的な API ルートが優先されるため、本 catch-all は真に未マッチな場合のみ発火する。
// 全 HTTP メソッドで 404 を返す。
function notFound() {
  return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
