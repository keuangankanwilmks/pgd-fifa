import React from 'react';
import { Scale } from 'lucide-react';

interface LoadingModalProps {
  isOpen: boolean;
  message?: string;
}

export function LoadingModal({ isOpen, message = 'Memproses...' }: LoadingModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center transition-opacity duration-300">
      <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-6 min-w-[280px] transform scale-100 animate-in fade-in zoom-in duration-200">
        <div className="relative w-20 h-20 flex items-center justify-center">
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full border-4 border-gray-100"></div>
          {/* Spinning ring primary */}
          <div className="absolute inset-0 rounded-full border-4 border-[#009B4F] border-t-transparent animate-spin"></div>
          {/* Spinning ring secondary (slower, opposite direction) */}
          <div className="absolute inset-2 rounded-full border-4 border-[#C4D600] border-b-transparent animate-[spin_1.5s_linear_infinite_reverse] opacity-70"></div>
          {/* Center Icon */}
          <Scale className="w-8 h-8 text-[#009B4F] animate-pulse" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <h3 className="text-lg font-bold text-gray-800">Harap Tunggu</h3>
          <p className="text-sm font-medium text-gray-500 animate-pulse">{message}</p>
        </div>
      </div>
    </div>
  );
}
