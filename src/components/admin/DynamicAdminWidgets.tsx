'use client';
import dynamic from 'next/dynamic';

export const NewBookingListener = dynamic(() => import('./NewBookingListener'), { ssr: false });
export const AiSupportWidget = dynamic(() => import('./AiSupportWidget'), { ssr: false });
