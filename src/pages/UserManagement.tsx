import React, { useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, Edit2, Trash2, Shield, User as UserIcon, CheckCircle, XCircle, Search, KeyRound, Save, Plus } from 'lucide-react';
import { User } from '../App';
import { db, handleFirestoreError, OperationType, firebaseConfig } from '../firebase';
import { doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, setPersistence, inMemoryPersistence } from 'firebase/auth';
import toast from 'react-hot-toast';
import { useNotifications } from '../contexts/NotificationContext';
import {
  DEFAULT_ROLE_ACCESS_CONFIGS,
  getAllLeafMenuItems,
  getRoleLabel,
  mergeRoleAccessConfigs,
  type RoleAccessConfig,
  type RoleAccessMap,
} from '../constants/menuItems';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  currentUser: User;
  setIsLoading: (loading: boolean) => void;
  setLoadingMessage: (msg: string) => void;
  roleAccessMap: RoleAccessMap;
}

const configsToDraft = (configs: RoleAccessConfig[]) => (
  configs.reduce<Record<string, string[]>>((acc, config) => {
    acc[config.id] = config.menuIds;
    return acc;
  }, {})
);

const sanitizeRoleId = (value: string) => (
  value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '')
);

export function UserManagement({
  users,
  currentUser,
  setIsLoading,
  setLoadingMessage,
  roleAccessMap,
}: UserManagementProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<User | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [roleConfigs, setRoleConfigs] = useState<RoleAccessConfig[]>(DEFAULT_ROLE_ACCESS_CONFIGS);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('user');
  const [accessDraft, setAccessDraft] = useState<Record<string, string[]>>(() => configsToDraft(DEFAULT_ROLE_ACCESS_CONFIGS));
  const [newRoleName, setNewRoleName] = useState('');
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const { addNotification } = useNotifications();

  const [formData, setFormData] = useState<Partial<User>>({
    nik: '',
    name: '',
    role: 'user',
    status: 'active',
    password: '',
  });

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'role_access'), (snapshot) => {
      const storedConfigs = snapshot.docs.map(item => {
        const data = item.data();
        return {
          id: item.id,
          label: String(data.label || item.id),
          menuIds: Array.isArray(data.menuIds) ? data.menuIds : [],
        };
      });
      const mergedConfigs = mergeRoleAccessConfigs(storedConfigs);
      setRoleConfigs(mergedConfigs);
      setAccessDraft(configsToDraft(mergedConfigs));
    }, (error) => {
      console.error('Role access listener error:', error);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!roleConfigs.some(config => config.id === selectedRoleId)) {
      setSelectedRoleId(roleConfigs[0]?.id || 'user');
    }
  }, [roleConfigs, selectedRoleId]);

  const allMenuOptions = useMemo(() => getAllLeafMenuItems(), []);
  const selectedRoleConfig = roleConfigs.find(config => config.id === selectedRoleId) || roleConfigs[0];
  const selectedMenuIds = accessDraft[selectedRoleId] || roleAccessMap[selectedRoleId] || selectedRoleConfig?.menuIds || [];
  const isSelectedRoleAdmin = selectedRoleId === 'admin';

  const filteredUsers = users.filter(u =>
    (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.nik || '').includes(searchTerm)
  );

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({ ...user, password: '' });
    } else {
      setEditingUser(null);
      setFormData({
        nik: '',
        name: '',
        role: 'user',
        status: 'active',
        password: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoadingMessage('Menyimpan data user...');
    setIsLoading(true);

    try {
      if (editingUser) {
        const userRef = doc(db, 'users', editingUser.uid || editingUser.nik);
        const updateData: any = {
          name: formData.name,
          role: formData.role,
          status: formData.status,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        await updateDoc(userRef, updateData);
        toast.success('User berhasil diupdate');
        addNotification('User berhasil diupdate', `Data user ${formData.name} berhasil diperbarui.`, 'success');
      } else {
        const q = query(collection(db, 'users'), where('nik', '==', formData.nik));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setAlertMessage('NIK sudah terdaftar!');
          setIsLoading(false);
          return;
        }

        let uid = '';
        const email = `${formData.nik}@fifa.local`;
        const password = formData.password || '123456';

        if (password.length < 6) {
          setAlertMessage('Password minimal 6 karakter!');
          setIsLoading(false);
          return;
        }

        try {
          const secondaryApp = getApps().find(app => app.name === 'SecondaryApp') || initializeApp(firebaseConfig, 'SecondaryApp');
          const secondaryAuth = getAuth(secondaryApp);
          await setPersistence(secondaryAuth, inMemoryPersistence);
          const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
          uid = userCredential.user.uid;
        } catch (authError: any) {
          console.error('Auth creation error:', authError);
          if (authError.code === 'auth/operation-not-allowed') {
            setAlertMessage('Fitur Login Email/Password belum diaktifkan di Firebase Console. Silakan aktifkan di menu Authentication > Sign-in method.');
            setIsLoading(false);
            return;
          }
          if (authError.code === 'auth/email-already-in-use') {
            setAlertMessage('Email/NIK sudah terdaftar di sistem autentikasi.');
            setIsLoading(false);
            return;
          }
          throw authError;
        }

        const newUser: User = {
          uid,
          nik: formData.nik!,
          name: formData.name!,
          role: formData.role || 'user',
          status: formData.status as 'active' | 'inactive',
          email,
        };

        await setDoc(doc(db, 'users', uid), newUser);
        toast.success('User berhasil ditambahkan');
        addNotification('User baru ditambahkan', `User ${formData.name} berhasil ditambahkan ke sistem.`, 'success');
      }
      handleCloseModal();
    } catch (error) {
      console.error('Error saving user:', error);
      toast.error('Gagal menyimpan data user');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (userToDelete: User) => {
    if (userToDelete.role === 'admin' && userToDelete.email === 'keuangan.kanwilmks@gmail.com') {
      setAlertMessage('Akun Super Administrator tidak dapat dihapus.');
      return;
    }
    if (userToDelete.uid && currentUser.uid === userToDelete.uid) {
      setAlertMessage('User yang sedang login tidak dapat menghapus akunnya sendiri.');
      return;
    }
    setDeleteConfirmUser(userToDelete);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmUser) return;

    setLoadingMessage('Menghapus user...');
    setIsLoading(true);
    const userToDelete = deleteConfirmUser;
    setDeleteConfirmUser(null);

    try {
      await deleteDoc(doc(db, 'users', userToDelete.uid || userToDelete.nik));
      toast.success('User berhasil dihapus');
      addNotification('User berhasil dihapus', `User ${userToDelete.name} telah dihapus dari sistem.`, 'success');
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Gagal menghapus user');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMenuAccess = (menuId: string) => {
    if (isSelectedRoleAdmin) return;
    setAccessDraft(prev => {
      const current = prev[selectedRoleId] || [];
      const next = current.includes(menuId)
        ? current.filter(id => id !== menuId)
        : [...current, menuId];
      return { ...prev, [selectedRoleId]: next };
    });
  };

  const handleAddRole = async () => {
    const label = newRoleName.trim();
    const id = sanitizeRoleId(label);

    if (!label || !id) {
      toast.error('Nama role belum valid');
      return;
    }
    if (roleConfigs.some(config => config.id === id)) {
      toast.error('Role sudah tersedia');
      return;
    }

    setIsSavingAccess(true);
    try {
      const newConfig = { id, label, menuIds: ['dashboard'] };
      setRoleConfigs(prev => mergeRoleAccessConfigs([...prev, newConfig]));
      setAccessDraft(prev => ({ ...prev, [id]: ['dashboard'] }));
      await setDoc(doc(db, 'role_access', id), {
        label,
        menuIds: ['dashboard'],
        createdAt: new Date().toISOString(),
      }, { merge: true });
      setSelectedRoleId(id);
      setNewRoleName('');
      toast.success(`Role ${label} berhasil ditambahkan`);
    } catch (error) {
      console.error('Add role error:', error);
      toast.error('Gagal menambahkan role');
    } finally {
      setIsSavingAccess(false);
    }
  };

  const saveRoleAccess = async () => {
    if (!selectedRoleConfig) return;

    const menuIds = isSelectedRoleAdmin
      ? allMenuOptions.map(item => item.id)
      : selectedMenuIds;

    setIsSavingAccess(true);
    try {
      await setDoc(doc(db, 'role_access', selectedRoleId), {
        label: selectedRoleConfig.label,
        menuIds,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      toast.success('Akses user berhasil disimpan');
    } catch (error) {
      console.error('Save role access error:', error);
      handleFirestoreError(error, OperationType.UPDATE, `role_access/${selectedRoleId}`);
    } finally {
      setIsSavingAccess(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-800">
            <Users className="h-6 w-6 text-[#009B4F]" />
            Manajemen User
          </h1>
          <p className="mt-1 text-sm text-gray-500">Kelola pengguna, role, dan akses sub menu aplikasi FIFA.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIsAccessModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 font-bold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <KeyRound className="h-5 w-5 text-[#009B4F]" />
            Akses User
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 rounded-xl bg-[#009B4F] px-4 py-2.5 font-bold text-white shadow-sm shadow-[#009B4F]/20 transition-colors hover:bg-[#008543]"
          >
            <UserPlus className="h-5 w-5" />
            Tambah User
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 p-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Cari berdasarkan NIK atau Nama..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full rounded-lg border border-gray-200 py-2 pl-10 pr-3 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#009B4F]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-sm">
              <tr>
                <th className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-500">NIK</th>
                <th className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-500">Nama Lengkap</th>
                <th className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-500">Role</th>
                <th className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-500">Status</th>
                <th className="border-b border-gray-100 px-4 py-3 text-right font-semibold text-gray-500">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredUsers.map((user) => (
                <tr key={user.uid || user.nik} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{user.nik}</td>
                  <td className="px-4 py-3 text-gray-600">{user.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {user.role === 'admin' ? <Shield className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                      {getRoleLabel(user.role, roleConfigs)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {user.status === 'active' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {user.status === 'active' ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenModal(user)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                        title="Edit User"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        disabled={user.role === 'admin'}
                        className={`rounded-lg p-1.5 transition-colors ${
                          user.role === 'admin'
                            ? 'cursor-not-allowed text-gray-300'
                            : 'text-gray-400 hover:bg-red-50 hover:text-red-600'
                        }`}
                        title={user.role === 'admin' ? 'Administrator tidak dapat dihapus' : 'Hapus User'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    Tidak ada data user ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAccessModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex flex-col justify-between gap-3 border-b border-gray-100 bg-gray-50/50 p-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Pengaturan Akses User</h2>
                <p className="mt-1 text-xs text-gray-500">Atur akses sub menu untuk setiap role. Menu baru otomatis muncul dari konfigurasi aplikasi.</p>
              </div>
              <button
                onClick={() => setIsAccessModalOpen(false)}
                className="self-start rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[280px_1fr]">
              <div className="flex min-h-0 flex-col border-r border-gray-100 bg-gray-50/60">
                <div className="border-b border-gray-100 p-4">
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Tambah Role</label>
                  <div className="flex gap-2">
                    <input
                      value={newRoleName}
                      onChange={(event) => setNewRoleName(event.target.value)}
                      placeholder="Contoh: Supervisor"
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
                    />
                    <button
                      onClick={handleAddRole}
                      disabled={isSavingAccess}
                      className="rounded-lg bg-[#009B4F] p-2 text-white transition-colors hover:bg-[#008543] disabled:opacity-50"
                      title="Tambah role"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  {roleConfigs.map(config => (
                    <button
                      key={config.id}
                      onClick={() => setSelectedRoleId(config.id)}
                      className={`mb-2 w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        selectedRoleId === config.id
                          ? 'border-[#009B4F] bg-emerald-50 text-[#005245]'
                          : 'border-gray-100 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold">{config.label}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gray-500">
                          {(accessDraft[config.id] || config.menuIds).length}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-400">{config.id}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="flex flex-col justify-between gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-black text-gray-800">{selectedRoleConfig?.label || 'Role'}</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      {isSelectedRoleAdmin
                        ? 'Administrator selalu memiliki akses penuh.'
                        : `${selectedMenuIds.length} dari ${allMenuOptions.length} sub menu dipilih.`}
                    </p>
                  </div>
                  <button
                    onClick={saveRoleAccess}
                    disabled={isSavingAccess}
                    className="flex items-center justify-center gap-2 rounded-lg bg-[#009B4F] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#008543] disabled:opacity-50"
                  >
                    {isSavingAccess ? <Save className="h-4 w-4 animate-pulse" /> : <Save className="h-4 w-4" />}
                    Simpan Akses
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {allMenuOptions.map(menu => {
                      const checked = isSelectedRoleAdmin || selectedMenuIds.includes(menu.id);
                      return (
                        <label
                          key={menu.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                            checked ? 'border-emerald-100 bg-emerald-50/80' : 'border-gray-100 bg-white hover:bg-gray-50'
                          } ${isSelectedRoleAdmin ? 'cursor-not-allowed opacity-80' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isSelectedRoleAdmin}
                            onChange={() => toggleMenuAccess(menu.id)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-[#009B4F] focus:ring-[#009B4F]"
                          />
                          <span>
                            <span className="block text-sm font-bold text-gray-800">{menu.label}</span>
                            {menu.parentLabel && (
                              <span className="mt-0.5 block text-[11px] text-gray-400">{menu.parentLabel}</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 p-5">
              <h2 className="text-lg font-bold text-gray-800">
                {editingUser ? 'Edit User' : 'Tambah User Baru'}
              </h2>
              <button onClick={handleCloseModal} className="text-gray-400 transition-colors hover:text-gray-600">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">NIK</label>
                <input
                  type="text"
                  required
                  disabled={!!editingUser}
                  value={formData.nik}
                  onChange={(e) => setFormData({ ...formData, nik: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-[#009B4F] disabled:bg-gray-100 disabled:text-gray-500"
                  placeholder="Masukkan NIK"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-[#009B4F]"
                  placeholder="Masukkan Nama Lengkap"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#009B4F]"
                  >
                    {roleConfigs.map(config => (
                      <option key={config.id} value={config.id}>{config.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#009B4F]"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Password {editingUser && <span className="text-xs font-normal text-gray-400">(Kosongkan jika tidak ingin mengubah)</span>}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  minLength={6}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-[#009B4F]"
                  placeholder={editingUser ? '********' : 'Masukkan Password (min. 6 karakter)'}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="cursor-pointer rounded-lg px-4 py-2 font-medium text-gray-600 transition-colors hover:bg-gray-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg bg-[#009B4F] px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-[#008543]"
                >
                  Simpan Data
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {alertMessage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex flex-col items-center gap-4 p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-500">
                <XCircle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-1 text-lg font-bold text-gray-800">Perhatian</h3>
                <p className="text-sm text-gray-500">{alertMessage}</p>
              </div>
              <button
                onClick={() => setAlertMessage(null)}
                className="mt-2 w-full cursor-pointer rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-800 transition-colors hover:bg-gray-200"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex flex-col items-center gap-4 p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-500">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-1 text-lg font-bold text-gray-800">Hapus User</h3>
                <p className="text-sm text-gray-500">
                  Apakah Anda yakin ingin menghapus user <span className="font-bold text-gray-700">{deleteConfirmUser.name}</span>? Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <div className="mt-2 flex w-full gap-3">
                <button
                  onClick={() => setDeleteConfirmUser(null)}
                  className="flex-1 cursor-pointer rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-800 transition-colors hover:bg-gray-200"
                >
                  Batal
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 cursor-pointer rounded-lg bg-red-500 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-red-600"
                >
                  Hapus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
