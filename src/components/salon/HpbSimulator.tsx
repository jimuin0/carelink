'use client';

import { useState } from 'react';

export default function HpbSimulator() {
  const [monthlyFee, setMonthlyFee] = useState(30000);
  const [bookingsPerMonth, setBookingsPerMonth] = useState(50);
  const [feePerBooking, setFeePerBooking] = useState(200);

  const monthlySaving = monthlyFee + bookingsPerMonth * feePerBooking;
  const annualSaving = monthlySaving * 12;

  return (
    <div className="bg-gradient-to-br from-sky-50 to-indigo-50 rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto">
      <h3 className="text-lg font-bold text-gray-800 mb-6 text-center">💰 節約シミュレーター</h3>

      <div className="space-y-6 mb-8">
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700">現在の月額費用</label>
            <span className="text-lg font-bold text-sky-600">¥{monthlyFee.toLocaleString()}</span>
          </div>
          <input
            type="range"
            aria-label="現在の月額費用"
            min={0}
            max={100000}
            step={5000}
            value={monthlyFee}
            onChange={(e) => setMonthlyFee(Number(e.target.value))}
            className="w-full accent-sky-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>¥0</span><span>¥50,000</span><span>¥100,000</span>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700">月間予約件数</label>
            <span className="text-lg font-bold text-sky-600">{bookingsPerMonth}件</span>
          </div>
          <input
            type="range"
            aria-label="月間予約件数"
            min={0}
            max={200}
            step={10}
            value={bookingsPerMonth}
            onChange={(e) => setBookingsPerMonth(Number(e.target.value))}
            className="w-full accent-sky-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0件</span><span>100件</span><span>200件</span>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700">予約手数料（1件あたり）</label>
            <span className="text-lg font-bold text-sky-600">¥{feePerBooking}</span>
          </div>
          <input
            type="range"
            aria-label="予約手数料（1件あたり）"
            min={0}
            max={1000}
            step={50}
            value={feePerBooking}
            onChange={(e) => setFeePerBooking(Number(e.target.value))}
            className="w-full accent-sky-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>¥0</span><span>¥500</span><span>¥1,000</span>
          </div>
        </div>
      </div>

      {/* 結果 */}
      <div className="bg-white rounded-xl p-6 text-center shadow-sm">
        <p className="text-sm text-gray-500 mb-1">CareLink に切り替えると</p>
        <p className="text-4xl font-extrabold text-sky-600 mb-1">
          月 ¥{monthlySaving.toLocaleString()}
        </p>
        <p className="text-gray-500 text-sm">節約できます</p>
        <div className="mt-4 py-3 bg-sky-50 rounded-lg">
          <p className="text-sm text-sky-700 font-bold">
            年間 <span className="text-2xl">¥{annualSaving.toLocaleString()}</span> の節約
          </p>
        </div>
        {annualSaving > 0 && (
          <p className="text-xs text-gray-500 mt-3">
            ※CareLink の月額・手数料はすべて¥0です
          </p>
        )}
      </div>
    </div>
  );
}
