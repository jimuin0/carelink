'use client';
import dynamic from 'next/dynamic';

export const RevenueChart = dynamic(() => import('./RevenueChart'), { ssr: false });
export const BookingTrendChart = dynamic(() => import('./BookingTrendChart'), { ssr: false });
export const CustomerSegmentChart = dynamic(() => import('./CustomerSegmentChart'), { ssr: false });
export const RepeatRateCard = dynamic(() => import('./RepeatRateCard'), { ssr: false });
export const ViewCountCard = dynamic(() => import('./ViewCountCard'), { ssr: false });
