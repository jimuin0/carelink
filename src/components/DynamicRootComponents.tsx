'use client';
import dynamic from 'next/dynamic';

export const SpeedInsights = dynamic(() => import('@vercel/speed-insights/next').then(m => ({ default: m.SpeedInsights })), { ssr: false });
export const CookieConsent = dynamic(() => import('./CookieConsent'), { ssr: false });
