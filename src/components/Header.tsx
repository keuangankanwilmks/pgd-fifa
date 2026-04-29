import React, { useState, useRef, useEffect } from 'react';
import { Menu, Bell, Search, X, Check, Info, AlertTriangle, AlertCircle, Trash2 } from 'lucide-react';
import { User } from '../App';
import { getMenuItems, flattenMenuItems } from '../constants/menuItems';
import { useNotifications } from '../contexts/NotificationContext';

interface HeaderProps {
  sidebarOpen: boolean;
  setSidebarOpen: (isOpen: boolean) => void;
  currentUser: User;
  setActiveTab: (tab: string) => void;
}

export function Header({ sidebarOpen, setSidebarOpen, currentUser, setActiveTab }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearNotifications } = useNotifications();
  
  const searchRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  const menuItems = getMenuItems(currentUser.role);
  const flatMenus = flattenMenuItems(menuItems);

  const filteredMenus = flatMenus.filter(menu => 
    menu.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (menu.parentLabel && menu.parentLabel.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getIconForType = (type: string) => {
    switch (type) {
      case 'success': return <Check className="w-4 h-4 text-green-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <header className="bg-white border-b border-gray-100 h-16 flex items-center justify-between px-4 lg:px-6 flex-shrink-0 z-30">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>
        
        <div className="hidden md:flex items-center relative" ref={searchRef}>
          <Search className="w-4 h-4 absolute left-3 text-gray-400" />
          <input 
            type="text" 
            placeholder="Pencarian..." 
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            className="pl-9 pr-4 py-2 bg-gray-50 border border-transparent focus:bg-white focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 rounded-lg text-sm w-64 transition-all outline-none"
          />
          
          {showSearchResults && searchQuery && (
            <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 py-2 max-h-96 overflow-y-auto z-50">
              <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-50 mb-1">
                Hasil Pencarian Menu
              </div>
              {filteredMenus.length > 0 ? (
                filteredMenus.map(menu => (
                  <button
                    key={menu.id}
                    onClick={() => {
                      setActiveTab(menu.id);
                      setSearchQuery('');
                      setShowSearchResults(false);
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex flex-col gap-0.5"
                  >
                    <span className="text-sm font-medium text-gray-700">{menu.label}</span>
                    {menu.parentLabel && (
                      <span className="text-xs text-gray-400">{menu.parentLabel}</span>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-gray-400 text-sm">
                  Tidak ada menu yang ditemukan
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative" ref={notificationRef}>
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700">Notifikasi</span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => markAllAsRead()}
                    className="text-[10px] text-[#009B4F] hover:underline font-semibold"
                  >
                    Tandai semua dibaca
                  </button>
                  <button 
                    onClick={() => clearNotifications()}
                    className="text-[10px] text-red-500 hover:underline font-semibold flex items-center gap-1"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    Hapus
                  </button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length > 0 ? (
                  notifications.map(notification => (
                    <div 
                      key={notification.id}
                      onClick={() => !notification.read && markAsRead(notification.id)}
                      className={`px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors cursor-pointer flex gap-3 ${!notification.read ? 'bg-blue-50/30' : ''}`}
                    >
                      <div className="mt-1 shrink-0">
                        {getIconForType(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <p className={`text-sm font-semibold truncate ${!notification.read ? 'text-gray-900' : 'text-gray-600'}`}>
                            {notification.title}
                          </p>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">
                            {notification.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
                          {notification.message}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-12 text-center">
                    <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-gray-400 text-sm">Belum ada notifikasi</p>
                  </div>
                )}
              </div>
              {notifications.length > 0 && (
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-center">
                  <span className="text-[10px] text-gray-400">Menampilkan 20 notifikasi terakhir</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
