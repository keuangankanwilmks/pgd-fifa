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
import { DataAlokasiPage } from './pages/DataAlokasiPage';
import { InputDropping } from './pages/InputDropping';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { norekService } from './services/norekService';
import { cabangService } from './services/cabangService';
import { NotificationProvider } from './contexts/NotificationContext';
import { getPathFromTab, getTabFromPath } from './constants/routeConfig';
import { isMenuAllowed, normalizeRoleId, type RoleAccessMap } from './constants/menuItems';
import { type RoleDatabasePermissionMap } from './constants/databasePermissions';
import { PWAStatus } from './components/PWAStatus';
import { userAdminService } from './services/userAdminService';

export interface User {
  nik: string;
  name: string;
  role: string;
  status: 'active' | 'inactive';
  email?: string;
  uid?: string;
}

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
          if (!userDoc.exists()) throw new Error('Akun Firebase belum terdaftar di FIFA');
          const userData = { ...userDoc.data(), uid: firebaseUser.uid } as User;
          if (userData.status !== 'active') throw new Error('Akun FIFA tidak aktif');
          if (!userData.role) throw new Error('Role akun FIFA belum dikonfigurasi');
          
          setCurrentUser(userData);

          // Seed data after auth and profile are ready
          seedData();
        } catch (error) {
          console.error('Error fetching user profile:', error);
          setCurrentUser(null);
          await signOut(auth).catch(() => undefined);
        }
      } else {
        setCurrentUser(null);
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
    if (!currentUser || normalizeRoleId(currentUser.role) !== 'admin') {
      setUsers([]);
      return;
    }

    let cancelled = false;
    void userAdminService.list()
      .then(result => {
        if (!cancelled) setUsers(Array.isArray(result?.users) ? result.users : []);
      })
      .catch(error => {
        console.error('Users request error:', error);
        if (!cancelled) setUsers([]);
      });

    return () => { cancelled = true; };
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
              <Route path="/anggaran/input-dropping" element={guardRoute('input-dropping', <InputDropping currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
              <Route path="/anggaran/data-alokasi" element={guardRoute('data-alokasi', <DataAlokasiPage currentUser={currentUser} roleDatabasePermissionMap={roleDatabasePermissionMap} />)} />
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
