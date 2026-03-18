import React, { useEffect, useState } from 'react';
import { Home, Briefcase, Landmark, FileText, ChevronDown, ChevronRight, LogOut, User as UserIcon, Scale, Users, Settings, BarChart3, AppWindow, ExternalLink } from 'lucide-react';
import { User } from '../App';
import { Logo } from './Logo';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  onLogout: () => void;
}

export function Sidebar({ isOpen, setIsOpen, activeTab, setActiveTab, currentUser, onLogout }: SidebarProps) {
  const [mokerOpen, setMokerOpen] = React.useState(false);
  const [bankOpen, setBankOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [bniOpen, setBniOpen] = React.useState(false);
  const [briOpen, setBriOpen] = React.useState(false);
  const [bsiOpen, setBsiOpen] = React.useState(false);

  const menuItems = [
    { id: 'dashboard', label: 'Halaman Utama', icon: Home },
    { 
      id: 'moker', 
      label: 'Modal Kerja', 
      icon: Briefcase,
      subItems: [
        { id: 'proses-moker', label: 'Proses Moker' },
        { id: 'report-moker', label: 'Report Moker' }
      ],
      isOpen: mokerOpen,
      setIsOpen: setMokerOpen
    },
    { 
      id: 'rekonsiliasi', 
      label: 'Rekonsiliasi Bank', 
      icon: Landmark,
      subItems: [
        { 
          id: 'rekon-bni-parent', 
          label: 'BNI',
          isParent: true,
          isOpen: bniOpen,
          setIsOpen: setBniOpen,
          children: [
            { id: 'rekon-bni', label: 'Proses Rekon' },
            { id: 'data-rekon-bni', label: 'Data Rekon' }
          ]
        },
        { 
          id: 'rekon-bri-parent', 
          label: 'BRI',
          isParent: true,
          isOpen: briOpen,
          setIsOpen: setBriOpen,
          children: [
            { id: 'rekon-bri', label: 'Proses Rekon' },
            { id: 'data-rekon-bri', label: 'Data Rekon' }
          ]
        },
        { 
          id: 'rekon-bsi-parent', 
          label: 'BSI',
          isParent: true,
          isOpen: bsiOpen,
          setIsOpen: setBsiOpen,
          children: [
            { id: 'rekon-bsi', label: 'Proses Rekon' },
            { id: 'data-rekon-bsi', label: 'Data Rekon' }
          ]
        }
      ],
      isOpen: bankOpen,
      setIsOpen: setBankOpen
    },
    { id: 'hutang', label: 'Hutang Operasional Lain', icon: FileText },
    { id: 'report', label: 'Report', icon: BarChart3 },
    ...(currentUser.role === 'admin' ? [{
      id: 'settings',
      label: 'Setting',
      icon: Settings,
      subItems: [
        { id: 'setting-supporting-apps', label: 'Supporting App' },
        { id: 'user-management', label: 'Manajemen User' }
      ],
      isOpen: settingsOpen,
      setIsOpen: setSettingsOpen
    }] : [])
  ];

  return (
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
                    item.setIsOpen(!item.isOpen);
                  } else {
                    setActiveTab(item.id);
                  }
                }}
                className={`w-full flex items-center justify-start px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-left ${
                  activeTab === item.id && !item.subItems ? 'bg-[#009B4F] text-white shadow-md' : 'hover:bg-[#006A5A] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 flex-1">
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </div>
                {item.subItems && (
                  item.isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                )}
              </button>
              
              {item.subItems && item.isOpen && (
                <div className="mt-1 ml-4 pl-4 border-l border-[#006A5A] space-y-1">
                  {item.subItems.map((subItem: any) => (
                    <div key={subItem.id}>
                      {subItem.isParent ? (
                        <>
                          <button
                            onClick={() => subItem.setIsOpen(!subItem.isOpen)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-[#006A5A] hover:text-white transition-colors cursor-pointer"
                          >
                            <span>{subItem.label}</span>
                            {subItem.isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                          {subItem.isOpen && (
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

      <div className="p-4 border-t border-[#004237] flex flex-col gap-4">
        <div className="bg-[#004237]/50 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#65B32E] flex items-center justify-center text-white shadow-sm shrink-0">
              <UserIcon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{currentUser.name}</p>
              <p className="text-xs text-emerald-200/70 truncate">NIK: {currentUser.nik}</p>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </div>
        <div className="text-center pb-2">
          <p className="text-[10px] text-emerald-400/60 font-medium">
            &copy; 2026 Kanwil VI SulSelBarRa Maluku
          </p>
        </div>
      </div>
    </div>
  );
}
