/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './pages/Dashboard';
import { RekonBNI } from './pages/RekonBNI';
import { Login } from './pages/Login';
import { UserManagement } from './pages/UserManagement';
import { LoadingModal } from './components/LoadingModal';
import { Toaster } from 'react-hot-toast';
import { DataRekon } from './pages/DataRekon';
import { Report } from './pages/Report';
import { SupportingAppView } from './pages/SupportingAppView';
import { Settings } from './pages/Settings';
import { ProsesMoker } from './pages/ProsesMoker';
import { DataMoker } from './pages/DataMoker';
import { HutangOperasional } from './pages/HutangOperasional';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { norekService } from './services/norekService';
import { cabangService } from './services/cabangService';
import { NotificationProvider } from './contexts/NotificationContext';

export interface User {
  nik: string;
  name: string;
  role: 'admin' | 'user';
  status: 'active' | 'inactive';
  password?: string;
  email?: string;
  uid?: string;
}

const INITIAL_USERS: User[] = [
  { nik: 'admin', name: 'Administrator', role: 'admin', status: 'active', password: 'admin' },
  { nik: '123456', name: 'User Biasa', role: 'user', status: 'active', password: 'password' }
];

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Menginisialisasi aplikasi...');
  const [rekonInitialData, setRekonInitialData] = useState<{
    bank: string;
    sistemData: any[];
    bankData: any[];
    rowIndices?: number[];
  } | null>(null);

  useEffect(() => {
    // Seed Firestore data if needed
    const seedData = async () => {
      try {
        await norekService.getAll();
        await cabangService.getAll();
      } catch (error) {
        console.error('Error seeding data:', error);
      }
    };

    let usersUnsub: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setIsLoading(true);
      
      // Clean up previous users listener if any
      if (usersUnsub) {
        usersUnsub();
        usersUnsub = null;
      }

      if (firebaseUser) {
        setLoadingMessage('Memuat profil...');
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          let userData: User;

          if (userDoc.exists()) {
            userData = userDoc.data() as User;
          } else {
            // Check if user exists by email (for non-google users who might be logging in)
            const isAdminUser = firebaseUser.email === 'keuangan.kanwilmks@gmail.com';
            userData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              name: firebaseUser.displayName || 'User',
              nik: firebaseUser.email ? firebaseUser.email.split('@')[0].toUpperCase() : `G-${firebaseUser.uid.substring(0, 8)}`,
              role: isAdminUser ? 'admin' : 'user',
              status: 'active'
            };
            await setDoc(doc(db, 'users', firebaseUser.uid), userData);
          }
          
          setCurrentUser(userData);

          // Only listen to all users if admin
          if (userData.role === 'admin') {
            usersUnsub = onSnapshot(collection(db, 'users'), (snapshot) => {
              const usersData = snapshot.docs.map(doc => doc.data() as User);
              setUsers(usersData);
            }, (error) => {
              console.error('Users listener error:', error);
              handleFirestoreError(error, OperationType.GET, 'users');
            });
          }

          // Seed data after auth and profile are ready
          seedData();
        } catch (error) {
          console.error('Error fetching user profile:', error);
          const fallbackUser: User = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: firebaseUser.displayName || 'User',
            nik: firebaseUser.email ? firebaseUser.email.split('@')[0].toUpperCase() : `G-${firebaseUser.uid.substring(0, 8)}`,
            role: firebaseUser.email === 'keuangan.kanwilmks@gmail.com' ? 'admin' : 'user',
            status: 'active'
          };
          setCurrentUser(fallbackUser);
          
          if (fallbackUser.role === 'admin') {
            usersUnsub = onSnapshot(collection(db, 'users'), (snapshot) => {
              const usersData = snapshot.docs.map(doc => doc.data() as User);
              setUsers(usersData);
            }, (error) => {
              console.error('Users listener error (fallback):', error);
            });
          }
        }
      } else {
        setCurrentUser(null);
        setUsers([]);
      }
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
      if (usersUnsub) usersUnsub();
    };
  }, []);

  const handleLogin = (user: User) => {
    // Auth state change will handle the rest
    setCurrentUser(user);
  };

  const handleLogout = async () => {
    setLoadingMessage('Keluar dari aplikasi...');
    setIsLoading(true);
    try {
      await signOut(auth);
      setCurrentUser(null);
      setActiveTab('dashboard');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTabChange = (tab: string) => {
    if (tab === activeTab) return;
    setLoadingMessage('Memuat halaman...');
    setIsLoading(true);
    setTimeout(() => {
      setActiveTab(tab);
      setIsLoading(false);
    }, 400);
  };

  const handleUpdateRekon = (bank: string, date: string, sistemData: any[], bankData: any[], rowIndices: number[]) => {
    setRekonInitialData({ bank, sistemData, bankData, rowIndices });
    setActiveTab(`rekon-${bank.toLowerCase()}`);
  };

  if (!currentUser) {
    return (
      <>
        <LoadingModal isOpen={isLoading} message={loadingMessage} />
        <Login onLogin={handleLogin} users={users} />
      </>
    );
  }

  // Helper to get a readable title for placeholder pages
  const getPageTitle = (tabId: string) => {
    const titles: Record<string, string> = {
      'proses-moker': 'Proses Modal Kerja',
      'data-moker': 'Data Modal Kerja',
      'rekon-bni': 'Proses Rekonsiliasi Bank BNI',
      'data-rekon-bni': 'Data Rekonsiliasi Bank BNI',
      'rekon-bri': 'Proses Rekonsiliasi Bank BRI',
      'data-rekon-bri': 'Data Rekonsiliasi Bank BRI',
      'rekon-bsi': 'Proses Rekonsiliasi Bank BSI',
      'data-rekon-bsi': 'Data Rekonsiliasi Bank BSI',
      'hutang': 'Hutang Operasional Lain',
      'user-management': 'Manajemen User',
      'report': 'Report Summary',
      'setting-supporting-apps': 'Pengaturan Supporting App',
      'setting-general': 'Manajemen Data'
    };
    if (tabId.startsWith('support-')) return 'Supporting App';
    return titles[tabId] || tabId;
  };

  return (
    <NotificationProvider>
      <Toaster position="top-right" />
      <LoadingModal isOpen={isLoading} message={loadingMessage} />
      <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
        <Sidebar 
          isOpen={sidebarOpen} 
          setIsOpen={setSidebarOpen} 
          activeTab={activeTab} 
          setActiveTab={handleTabChange} 
          currentUser={currentUser}
          onLogout={handleLogout}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header 
            sidebarOpen={sidebarOpen} 
            setSidebarOpen={setSidebarOpen} 
            currentUser={currentUser}
            setActiveTab={handleTabChange}
          />
          <main className="flex-1 overflow-y-auto p-6">
            {activeTab === 'dashboard' && <Dashboard onAppClick={(id) => handleTabChange(`support-${id}`)} />}
            {activeTab === 'proses-moker' && <ProsesMoker />}
            {activeTab === 'data-moker' && <DataMoker currentUser={currentUser} />}
            {activeTab === 'rekon-bni' && (
              <RekonBNI 
                bank="BNI"
                initialData={rekonInitialData?.bank === 'BNI' ? rekonInitialData : null}
                onClearInitialData={() => setRekonInitialData(null)}
                setIsLoading={setIsLoading} 
                setLoadingMessage={setLoadingMessage} 
              />
            )}
            {activeTab === 'data-rekon-bni' && <DataRekon bank="BNI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} />}
            {activeTab === 'rekon-bri' && (
              <RekonBNI 
                bank="BRI" 
                initialData={rekonInitialData?.bank === 'BRI' ? rekonInitialData : null}
                onClearInitialData={() => setRekonInitialData(null)}
                setIsLoading={setIsLoading} 
                setLoadingMessage={setLoadingMessage} 
              />
            )}
            {activeTab === 'data-rekon-bri' && <DataRekon bank="BRI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} />}
            {activeTab === 'rekon-bsi' && (
              <RekonBNI 
                bank="BSI" 
                initialData={rekonInitialData?.bank === 'BSI' ? rekonInitialData : null}
                onClearInitialData={() => setRekonInitialData(null)}
                setIsLoading={setIsLoading} 
                setLoadingMessage={setLoadingMessage} 
              />
            )}
            {activeTab === 'data-rekon-bsi' && <DataRekon bank="BSI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} />}
            {activeTab === 'report' && <Report />}
            {activeTab === 'hutang' && <HutangOperasional />}
            {activeTab.startsWith('support-') && <SupportingAppView tabId={activeTab} />}
            {activeTab === 'setting-supporting-apps' && currentUser.role === 'admin' && <Settings type="supporting-apps" />}
            {activeTab === 'setting-general' && currentUser.role === 'admin' && <Settings type="general" />}
            {activeTab === 'user-management' && currentUser.role === 'admin' && (
              <UserManagement users={users} setUsers={setUsers} currentUser={currentUser} setIsLoading={setIsLoading} setLoadingMessage={setLoadingMessage} />
            )}
          {activeTab !== 'dashboard' && 
           activeTab !== 'proses-moker' &&
           activeTab !== 'data-moker' &&
           activeTab !== 'rekon-bni' && 
           activeTab !== 'data-rekon-bni' && 
           activeTab !== 'rekon-bri' && 
           activeTab !== 'data-rekon-bri' && 
           activeTab !== 'rekon-bsi' && 
           activeTab !== 'data-rekon-bsi' && 
           activeTab !== 'report' && 
           activeTab !== 'hutang' &&
           !activeTab.startsWith('support-') && 
           activeTab !== 'setting-supporting-apps' && 
           activeTab !== 'setting-general' && 
           activeTab !== 'user-management' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 h-full flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-semibold text-gray-800 mb-2">{getPageTitle(activeTab)}</h2>
                <p className="text-gray-500">Konten halaman ini sedang dalam pengembangan.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
    </NotificationProvider>
  );
}

