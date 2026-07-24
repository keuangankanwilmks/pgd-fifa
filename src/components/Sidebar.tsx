import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, LogOut, Share2, User as UserIcon } from 'lucide-react';
import { User } from '../App';
import { Logo } from './Logo';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { getMenuItems, type RoleAccessMap } from '../constants/menuItems';
import { ConfirmModal } from './ConfirmModal';
import { ProfileSettingsModal } from './ProfileSettingsModal';
import { usePWA } from '../contexts/PWAContext';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  onLogout: () => void;
  onProfileUpdated: (user: User) => void;
  roleAccessMap: RoleAccessMap;
}

export function Sidebar({ isOpen, setIsOpen, activeTab, setActiveTab, currentUser, onLogout, onProfileUpdated, roleAccessMap }: SidebarProps) {
  const [openSubMenus, setOpenSubMenus] = React.useState<Record<string, boolean>>({});
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = React.useState(false);
  const [isProfileOpen, setIsProfileOpen] = React.useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = React.useState(false);
  const [showIosInstallGuide, setShowIosInstallGuide] = React.useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const { canInstall, installApp, isIos } = usePWA();

  const menuItems = getMenuItems(currentUser.role, roleAccessMap);

  useEffect(() => {
    // Automatically open submenus that contain the active tab
    const newOpenSubMenus: Record<string, boolean> = { ...openSubMenus };
    let changed = false;

    menuItems.forEach(item => {
      if (item.subItems) {
        const hasActiveSub = item.subItems.some(sub => {
          if (sub.id === activeTab) return true;
          if (sub.children && sub.children.some(child => child.id === activeTab)) return true;
          return false;
        });

        if (hasActiveSub && !newOpenSubMenus[item.id]) {
          newOpenSubMenus[item.id] = true;
          changed = true;
        }

        item.subItems.forEach(sub => {
          if (sub.isParent && sub.children) {
            const hasActiveChild = sub.children.some(child => child.id === activeTab);
            if (hasActiveChild && !newOpenSubMenus[sub.id]) {
              newOpenSubMenus[sub.id] = true;
              changed = true;
            }
          }
        });
      }
    });

    if (changed) {
      setOpenSubMenus(newOpenSubMenus);
    }
  }, [activeTab, menuItems]);

  const toggleSubMenu = (id: string) => {
    setOpenSubMenus(prev => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current || userMenuRef.current.contains(event.target as Node)) return;
      setIsUserMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsUserMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUserMenuOpen]);

  return (
    <>
      <div className={`bg-[#005245] text-emerald-50 w-64 flex-shrink-0 flex flex-col transition-all duration-300 ${isOpen ? 'ml-0' : '-ml-64'} shadow-xl z-20`}>
        <div className="p-6 border-b border-[#004237] flex flex-col items-center">
        <Logo className="w-20 h-20" />
        <p className="mt-3 text-[9px] leading-tight text-white font-medium uppercase tracking-widest text-center">
          Financial Integrated Flow Application
        </p>
      </div>
      
      <div className="flex-1 overflow-y-auto py-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#006A5A] [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="px-4 mb-2 text-xs font-semibold text-emerald-300/60 uppercase tracking-wider">Navigasi Utama</div>
        <nav className="space-y-1 px-2">
          {menuItems.map((item) => (
            <div key={item.id}>
              <button
                onClick={() => {
                  if (item.subItems) {
                    toggleSubMenu(item.id);
                  } else {
                    setActiveTab(item.id);
                  }
                }}
                className={`w-full flex items-center justify-start px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-left ${
                  activeTab === item.id && !item.subItems ? 'bg-[#009B4F] text-white shadow-md' : 'hover:bg-[#006A5A] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 flex-1">
                  {item.icon && <item.icon className="w-5 h-5" />}
                  <span className="font-medium">{item.label}</span>
                </div>
                {item.subItems && (
                  openSubMenus[item.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                )}
              </button>
              
              {item.subItems && openSubMenus[item.id] && (
                <div className="mt-1 ml-4 pl-4 border-l border-[#006A5A] space-y-1">
                  {item.subItems.map((subItem: any) => (
                    <div key={subItem.id}>
                      {subItem.isParent ? (
                        <>
                          <button
                            onClick={() => toggleSubMenu(subItem.id)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-[#006A5A] hover:text-white transition-colors cursor-pointer"
                          >
                            <span>{subItem.label}</span>
                            {openSubMenus[subItem.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                          {openSubMenus[subItem.id] && (
                            <div className="ml-2 pl-2 border-l border-[#009B4F]/30 space-y-1 mt-1">
                              {subItem.children.map((child: any) => (
                                <button
                                  key={child.id}
                                  onClick={() => setActiveTab(child.id)}
                                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                                    activeTab === child.id ? 'text-[#C4D600] font-medium' : 'text-emerald-200/70 hover:text-white'
                                  }`}
                                >
                                  {child.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => setActiveTab(subItem.id)}
                          className={`w-full flex items-center justify-start px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-left ${
                            activeTab === subItem.id ? 'bg-[#009B4F]/20 text-[#C4D600] font-medium' : 'hover:bg-[#006A5A] hover:text-white'
                          }`}
                        >
                          {subItem.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="fifa-sidebar-footer p-4 border-t border-[#004237] flex flex-col gap-4">
        <div ref={userMenuRef} className="relative">
          {isUserMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[#006A5A] bg-[#004237] p-2 shadow-2xl fifa-modal-panel fifa-modal-open">
              <button
                onClick={() => {
                  setIsUserMenuOpen(false);
                  setIsProfileOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-emerald-50 transition-colors hover:bg-[#006A5A]"
              >
                <UserIcon className="h-4 w-4" />
                Profil Setting
              </button>
              {canInstall && (
                <button
                  onClick={async () => {
                    if (isIos) {
                      setShowIosInstallGuide(prev => !prev);
                      return;
                    }
                    await installApp();
                    setIsUserMenuOpen(false);
                  }}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-emerald-50 transition-colors hover:bg-[#006A5A]"
                >
                  <Download className="h-4 w-4" />
                  Instal Aplikasi
                </button>
              )}
              {showIosInstallGuide && isIos && (
                <div className="mx-1 mt-1 rounded-lg border border-emerald-400/20 bg-[#003a31] px-3 py-2 text-xs leading-relaxed text-emerald-50">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <Share2 className="h-3.5 w-3.5" />
                    Instal di iPhone/iPad
                  </div>
                  Tekan Share di Safari, lalu pilih Add to Home Screen.
                </div>
              )}
              <button
                onClick={() => {
                  setIsUserMenuOpen(false);
                  setIsLogoutConfirmOpen(true);
                }}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/15"
              >
                <LogOut className="h-4 w-4" />
                Keluar
              </button>
            </div>
          )}
          <button
            onClick={() => setIsUserMenuOpen(prev => !prev)}
            className="w-full rounded-xl bg-[#004237]/50 p-4 text-left transition-colors hover:bg-[#004237]/80"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#65B32E] flex items-center justify-center text-white shadow-sm shrink-0">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{currentUser.name}</p>
                <p className="text-xs text-emerald-200/70 truncate">NIK: {currentUser.nik}</p>
              </div>
              <ChevronDown className={`h-4 w-4 text-emerald-200 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </div>
        <div className="text-center pb-2">
          <p className="text-[10px] text-emerald-400/60 font-medium">
            &copy; 2026 Kanwil VI SulSelBarRa Maluku
          </p>
        </div>
      </div>
      </div>

      <ConfirmModal
        isOpen={isLogoutConfirmOpen}
        title="Konfirmasi Keluar"
        message="Apakah Anda yakin ingin keluar dari aplikasi?"
        onCancel={() => setIsLogoutConfirmOpen(false)}
        onConfirm={() => {
          setIsLogoutConfirmOpen(false);
          onLogout();
        }}
        confirmText="Ya"
        cancelText="Tidak"
        loadingText="Keluar..."
        variant="primary"
      />
      <ProfileSettingsModal
        isOpen={isProfileOpen}
        currentUser={currentUser}
        onClose={() => setIsProfileOpen(false)}
        onUpdated={onProfileUpdated}
      />
    </>
  );
}
