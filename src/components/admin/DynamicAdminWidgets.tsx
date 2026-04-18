'use client';
import dynamic from 'next/dynamic';

export const RealtimeBookingListener = dynamic(() => import('./RealtimeBookingListener'), { ssr: false });
export const AiSupportWidget = dynamic(() => import('./AiSupportWidget'), { ssr: false });
