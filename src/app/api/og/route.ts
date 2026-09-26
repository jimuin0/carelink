import { NextRequest } from 'next/server';
import { OG_IMAGE_HEADERS, renderOgImagePng } from '@/lib/og-image';

// ImageResponse uses an Edge bundle that exceeds the CareLink Vercel Hobby limit.
// Keep PNG output, but rasterize the small SVG in a Node.js Function via sharp.
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const image = await renderOgImagePng(req.nextUrl.searchParams);
  const body = new ArrayBuffer(image.byteLength);
  new Uint8Array(body).set(image);
  return new Response(body, { headers: OG_IMAGE_HEADERS });
}
