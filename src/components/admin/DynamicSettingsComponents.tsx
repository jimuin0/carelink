'use client';
import dynamic from 'next/dynamic';

export const NotificationSettings = dynamic(() => import('./NotificationSettings'), { ssr: false });
export const CancelPolicySettings = dynamic(() => import('./CancelPolicySettings'), { ssr: false });
