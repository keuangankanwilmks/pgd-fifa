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
import { SaldoHarian } from './pages/SaldoHarian';
import { DataDropPoll } from './pages/DataDropPoll';
import { DataAlokasi } from './pages/DataAlokasi';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { norekService } from './services/norekService';
import { cabangService } from './services/cabangService';
import { NotificationProvider } from './contexts/NotificationContext';
import { getPathFromTab, getTabFromPath } from './constants/routeConfig';
import { isMenuAllowed, normalizeRoleId, type RoleAccessMap } from './constants/menuItems';
import { type RoleDatabasePermissionMap } from './constants/databasePermissions';
import { PWAStatus } from './components/PWAStatus';

export interface User {
  nik: string;
  name: string;
  role: string;
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
  const [roleAccessMap, setRoleAccessMap] = useState<RoleAccessMap>({});
  const [roleDatabasePermissionMap, setRoleDatabasePermissionMap] = useState<RoleDatabasePermissionMap>({});
  const [isRoleAccessLoaded, setIsRoleAccessLoaded] = useState(false);
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

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setIsLoading(true);

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
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setRoleAccessMap({});
      setRoleDatabasePermissionMap({});
      setIsRoleAccessLoaded(false);
      return;
    }

    const normalizedRole = normalizeRoleId(currentUser.role);
    if (normalizedRole === 'admin') {
      setRoleAccessMap({});
      setRoleDatabasePermissionMap({});
      setIsRoleAccessLoaded(true);
      return;
    }

    setIsRoleAccessLoaded(false);
    setRoleAccessMap({});
    setRoleDatabasePermissionMap({});
    const unsubscribe = onSnapshot(doc(db, 'role_access', normalizedRole), (snapshot) => {
      if (!snapshot.exists()) {
        setRoleAccessMap({ [normalizedRole]: ['dashboard'] });
        setRoleDatabasePermissionMap({});
        setIsRoleAccessLoaded(true);
        return;
      }

      const data = snapshot.data();
      const menuIds = Array.isArray(data.menuIds) ? data.menuIds : ['dashboard'];
      const databasePermissions = data.databasePermissions && typeof data.databasePermissions === 'object'
        ? data.databasePermissions
        : {};

      setRoleAccessMap({ [normalizedRole]: menuIds });
      setRoleDatabasePermissionMap({ [normalizedRole]: databasePermissions });
      setIsRoleAccessLoaded(true);
    }, (error) => {
      console.error('Role access listener error:', error);
      setRoleAccessMap({ [normalizedRole]: ['dashboard'] });
      setRoleDatabasePermissionMap({});
      setIsRoleAccessLoaded(true);
    });

    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !isMenuAllowed(currentUser.role, 'user-management', roleAccessMap)) {
      setUsers([]);
      return;
    }

    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersData = snapshot.docs.map(doc => doc.data() as User);
      setUsers(usersData);
    }, (error) => {
      console.error('Users listener error:', error);
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    return () => unsubscribe();
  }, [currentUser, roleAccessMap]);

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

  const handleProfileUpdated = useCallback((updatedUser: User) => {
    setCurrentUser(updatedUser);
  }, []);

  // Idle timeout logic: 15 minutes
  useEffect(() => {
    if (!currentUser) return;

    let timeoutId: any;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        handleLogout();
      }, 60 * 60 * 1000); // 15 minutes
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

  const canAccess = (tab: string) => (
    currentUser ? isMenuAllowed(currentUser.role, tab, roleAccessMap) : false
  );

  const guardRoute = (tab: string, element: React.ReactElement) => (
    canAccess(tab) ? element : <Navigate to="/" replace />
  );

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

  const shouldWaitForRoleAccess = currentUser &&
    normalizeRoleId(currentUser.role) !== 'admin' &&
    !isRoleAccessLoaded;

  if (shouldWaitForRoleAccess) {
    return (
      <LoadingModal isOpen={true} message="Memuat akses user..." />
    );
  }

  return (
    <NotificationProvider>
      <Toaster position="top-right" />
      <PWAStatus />
      <LoadingModal isOpen={isLoading} message={loadingMessage} />
      <div className="fifa-app-shell flex h-[100dvh] overflow-hidden bg-gray-50 font-sans">
        <Sidebar 
          isOpen={sidebarOpen} 
          setIsOpen={setSidebarOpen} 
          activeTab={activeTab} 
          setActiveTab={handleTabChange} 
          currentUser={currentUser}
          onLogout={handleLogout}
          onProfileUpdated={handleProfileUpdated}
          roleAccessMap={roleAccessMap}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header 
            sidebarOpen={sidebarOpen} 
            setSidebarOpen={setSidebarOpen} 
            currentUser={currentUser}
            setActiveTab={handleTabChange}
            roleAccessMap={roleAccessMap}
          />
          <main className="flex-1 overflow-y-auto p-6">
            <Routes>
              <Route path="/" element={<Dashboard onAppClick={(id) => handleTabChange(`support-${id}`)} />} />
              <Route path="/modal-kerja/proses-moker" element={guardRoute('proses-moker', <ProsesMoker />)} />
              <Route path="/modal-kerja/data-moker" element={guardRoute('data-moker', <DataMoker currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/anggaran/data-alokasi" element={guardRoute('data-alokasi', <DataAlokasi currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/rekonsiliasi-bank/bni/proses-rekon" element={guardRoute('rekon-bni',
                <RekonBNI 
                  bank="BNI"
                  initialData={rekonInitialData?.bank === 'BNI' ? rekonInitialData : null}
                  onClearInitialData={() => setRekonInitialData(null)}
                  setIsLoading={setIsLoading} 
                  setLoadingMessage={setLoadingMessage} 
                />
              )} />
              <Route path="/rekonsiliasi-bank/bni/data-rekon" element={guardRoute('data-rekon-bni', <DataRekon bank="BNI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/rekonsiliasi-bank/bri/proses-rekon" element={guardRoute('rekon-bri',
                <RekonBNI 
                  bank="BRI" 
                  initialData={rekonInitialData?.bank === 'BRI' ? rekonInitialData : null}
                  onClearInitialData={() => setRekonInitialData(null)}
                  setIsLoading={setIsLoading} 
                  setLoadingMessage={setLoadingMessage} 
                />
              )} />
              <Route path="/rekonsiliasi-bank/bri/data-rekon" element={guardRoute('data-rekon-bri', <DataRekon bank="BRI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/rekonsiliasi-bank/bsi/proses-rekon" element={guardRoute('rekon-bsi',
                <RekonBNI 
                  bank="BSI" 
                  initialData={rekonInitialData?.bank === 'BSI' ? rekonInitialData : null}
                  onClearInitialData={() => setRekonInitialData(null)}
                  setIsLoading={setIsLoading} 
                  setLoadingMessage={setLoadingMessage} 
                />
              )} />
              <Route path="/rekonsiliasi-bank/bsi/data-rekon" element={guardRoute('data-rekon-bsi', <DataRekon bank="BSI" onUpdateRekon={handleUpdateRekon} currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/rekonsiliasi-bank/saldo-harian" element={guardRoute('saldo-harian', <SaldoHarian currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/rekonsiliasi-bank/data-drop-poll" element={guardRoute('data-drop-poll', <DataDropPoll currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/report" element={guardRoute('report', <Report currentUser={currentUser} />)} />
              <Route path="/hutang-operasional" element={guardRoute('hutang', <HutangOperasional currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/supporting-app/:id" element={<SupportingAppView tabId={activeTab} />} />
              <Route path="/settings/supporting-apps" element={guardRoute('setting-supporting-apps', <Settings type="supporting-apps" />)} />
              <Route path="/settings/manajemen-data" element={guardRoute('setting-general', <Settings type="general" />)} />
              <Route path="/settings/set-upload-excel" element={guardRoute('setting-upload-excel', <Settings type="upload-excel" />)} />
              <Route path="/settings/template-blast" element={guardRoute('setting-template-blast', <Settings type="template-blast" />)} />
              <Route path="/settings/template-blast-whatsapp" element={guardRoute('setting-template-blast-whatsapp', <Settings type="template-blast-whatsapp" />)} />
              <Route path="/settings/user-management" element={guardRoute('user-management',
                <UserManagement
                  users={users}
                  setUsers={setUsers}
                  currentUser={currentUser}
                  setIsLoading={setIsLoading}
                  setLoadingMessage={setLoadingMessage}
                  roleAccessMap={roleAccessMap}
                  roleDatabasePermissionMap={roleDatabasePermissionMap}
                />
              )} />
              
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}
