import React from 'react';
import { Menu, Bell, Search } from 'lucide-react';

interface HeaderProps {
  sidebarOpen: boolean;
  setSidebarOpen: (isOpen: boolean) => void;
}

export function Header({ sidebarOpen, setSidebarOpen }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-100 h-16 flex items-center justify-between px-4 lg:px-6 flex-shrink-0 z-10">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>
        
        <div className="hidden md:flex items-center relative">
          <Search className="w-4 h-4 absolute left-3 text-gray-400" />
          <input 
            type="text" 
            placeholder="Cari transaksi..." 
            className="pl-9 pr-4 py-2 bg-gray-50 border border-transparent focus:bg-white focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 rounded-lg text-sm w-64 transition-all outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
      </div>
    </header>
  );
}
