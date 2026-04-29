/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, Routes, Route, Navigate } from 'react-router-dom';
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
import { getPathFromTab, getTabFromPath } from './constants/routeConfig';

export interface User {
  nik: string;
  name: string;
  role: 'admin' | 'user' | 'guest';
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Menginisialisasi aplikasi...');
  const [rekonInitialData, setRekonInitialData] = useState<{
    bank: string;
    sistemData: any[];
    bankData: any[];
    rowIndices?: number[];
  } | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  // Sync activeTab with URL
  const activeTab = getTabFromPath(location.pathname);

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
        // Only clear currentUser if it's not a guest user
        setCurrentUser(prev => {
          if (prev?.role === 'guest') return prev;
          return null;
        });
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
    navigate('/');
  };

  const handleLogout = useCallback(async () => {
    setLoadingMessage('Keluar dari aplikasi...');
    setIsLoading(true);
    try {
      await signOut(auth);
      setCurrentUser(null);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [navigate]);

  // Idle timeout logic: 15 minutes
  useEffect(() => {
    if (!currentUser) return;

    let timeoutId: any;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        handleLogout();
      }, 15 * 60 * 1000); // 15 minutes
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    const handleActivity = () => resetTimer();

    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    resetTimer();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [currentUser, handleLogout]);

  const handleTabChange = (tab: string) => {
    if (tab === activeTab) return;
    setLoadingMessage('Memuat halaman...');
    setIsLoading(true);
    setTimeout(() => {
      navigate(getPathFromTab(tab));
      setIsLoading(false);
    }, 400);
  };

  const handleUpdateRekon = (bank: string, date: string, sistemData: any[], bankData: any[], rowIndices: number[]) => {
    setRekonInitialData({ bank, sistemData, bankData, rowIndices });
    navigate(`/rekonsiliasi-bank/${bank.toLowerCase()}/proses-rekon`);
  };

  if (!currentUser && location.pathname !== '/login') {
    return (
      <>
        <LoadingModal isOpen={isLoading} message={loadingMessage} />
        <Login onLogin={handleLogin} users={users} />
      </>
    );
  }

  if (!currentUser && location.pathname === '/login') {
    return (
      <>
        <LoadingModal isOpen={isLoading} message={loadingMessage} />
        <Login onLogin={handleLogin} users={users} />
      </>
    );
  }

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
            <Routes>
              <Route path="/" element={<Dashboard onAppClick={(id) => handleTabChange(`support-${id}`)} />} />
              <Route path="/modal-kerja/proses-moker" element={<ProsesMoker />} />
              <Route path="/modal-kerja/data-moker" element={<DataMoker currentUser={currentUser} />} />
              <Route path="/rekonsiliasi-bank/bni/proses-rekon" element={
                <RekonBNI 
                  bank="BNI"
                  initialData={rekonInitialData?.bank === 'BNI' ? rekonInitialData : null}
                  onClearInitialData={() => setRekonInitialData(null)}
                  setIsLoading={setIsLoading} 
                  setLoadingMessage={setLoadingMessage} 
                />
              } />
              <Route path="/rekonsiliasi-bank/bni/data-rekon" element={<DataRekon bank="BNI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} />} />
              <Route path="/rekonsiliasi-bank/bri/proses-rekon" element={
                <RekonBNI 
                  bank="BRI" 
                  initialData={rekonInitialData?.bank === 'BRI' ? rekonInitialData : null}
                  onClearInitialData={() => setRekonInitialData(null)}
                  setIsLoading={setIsLoading} 
                  setLoadingMessage={setLoadingMessage} 
                />
              } />
              <Route path="/rekonsiliasi-bank/bri/data-rekon" element={<DataRekon bank="BRI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} />} />
              <Route path="/rekonsiliasi-bank/bsi/proses-rekon" element={
                <RekonBNI 
                  bank="BSI" 
                  initialData={rekonInitialData?.bank === 'BSI' ? rekonInitialData : null}
                  onClearInitialData={() => setRekonInitialData(null)}
                  setIsLoading={setIsLoading} 
                  setLoadingMessage={setLoadingMessage} 
                />
              } />
              <Route path="/rekonsiliasi-bank/bsi/data-rekon" element={<DataRekon bank="BSI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} />} />
              <Route path="/report" element={<Report currentUser={currentUser} />} />
              <Route path="/hutang-operasional" element={<HutangOperasional />} />
              <Route path="/supporting-app/:id" element={<SupportingAppView tabId={activeTab} />} />
              
              {currentUser.role === 'admin' && (
                <>
                  <Route path="/settings/supporting-apps" element={<Settings type="supporting-apps" />} />
                  <Route path="/settings/manajemen-data" element={<Settings type="general" />} />
                  <Route path="/settings/user-management" element={
                    <UserManagement users={users} setUsers={setUsers} currentUser={currentUser} setIsLoading={setIsLoading} setLoadingMessage={setLoadingMessage} />
                  } />
                </>
              )}
              
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}

