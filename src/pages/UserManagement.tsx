import React, { useState } from 'react';
import { Users, UserPlus, Edit2, Trash2, Shield, User as UserIcon, CheckCircle, XCircle, Search } from 'lucide-react';
import { User } from '../App';
import { db, handleFirestoreError, OperationType, firebaseConfig } from '../firebase';
import { doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, setPersistence, inMemoryPersistence } from 'firebase/auth';
import toast from 'react-hot-toast';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  currentUser: User;
  setIsLoading: (loading: boolean) => void;
  setLoadingMessage: (msg: string) => void;
}

export function UserManagement({ users, setUsers, currentUser, setIsLoading, setLoadingMessage }: UserManagementProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<User | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  
  // Form State
  const [formData, setFormData] = useState<Partial<User>>({
    nik: '',
    name: '',
    role: 'user',
    status: 'active',
    password: ''
  });

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.nik.includes(searchTerm)
  );

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({ ...user, password: '' }); // Don't show actual password, leave blank for edit
    } else {
      setEditingUser(null);
      setFormData({
        nik: '',
        name: '',
        role: 'user',
        status: 'active',
        password: ''
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
        // Update existing user in Firestore
        const userRef = doc(db, 'users', editingUser.uid || editingUser.nik);
        const updateData: any = {
          name: formData.name,
          role: formData.role,
          status: formData.status
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        await updateDoc(userRef, updateData);
        toast.success('User berhasil diupdate');
      } else {
        // Add new user
        // Check if NIK exists in Firestore
        const q = query(collection(db, 'users'), where('nik', '==', formData.nik));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setAlertMessage('NIK sudah terdaftar!');
          setIsLoading(false);
          return;
        }

        // Create Firebase Auth account for non-google users
        // We use a secondary app instance to avoid logging out the current admin
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
          // If user already exists in Auth but not Firestore, we might want to handle it
          if (authError.code === 'auth/email-already-in-use') {
            // This is tricky, maybe they were deleted from Firestore but not Auth
            // For now, let's just show an error
            setAlertMessage('Email/NIK sudah terdaftar di sistem autentikasi.');
            setIsLoading(false);
            return;
          }
          throw authError;
        }
        
        const newUser: User = {
          uid: uid,
          nik: formData.nik!,
          name: formData.name!,
          role: formData.role as 'admin' | 'user',
          status: formData.status as 'active' | 'inactive',
          email: email
        };

        await setDoc(doc(db, 'users', uid), newUser);
        toast.success('User berhasil ditambahkan');
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
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Gagal menghapus user');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-[#009B4F]" />
            Manajemen User
          </h1>
          <p className="text-sm text-gray-500 mt-1">Kelola akses pengguna dan role aplikasi FIFA.</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-[#009B4F] hover:bg-[#008543] text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-sm shadow-[#009B4F]/20"
        >
          <UserPlus className="w-5 h-5" />
          Tambah User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="relative w-full max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Cari berdasarkan NIK atau Nama..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#009B4F] focus:border-transparent outline-none text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white shadow-sm z-10">
              <tr>
                <th className="py-3 px-4 text-gray-500 font-semibold border-b border-gray-100">NIK</th>
                <th className="py-3 px-4 text-gray-500 font-semibold border-b border-gray-100">Nama Lengkap</th>
                <th className="py-3 px-4 text-gray-500 font-semibold border-b border-gray-100">Role</th>
                <th className="py-3 px-4 text-gray-500 font-semibold border-b border-gray-100">Status</th>
                <th className="py-3 px-4 text-gray-500 font-semibold border-b border-gray-100 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredUsers.map((user) => (
                <tr key={user.uid || user.nik} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 font-medium text-gray-800">{user.nik}</td>
                  <td className="py-3 px-4 text-gray-600">{user.name}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {user.role === 'admin' ? <Shield className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                      {user.role === 'admin' ? 'Administrator' : 'User'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                      user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {user.status === 'active' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {user.status === 'active' ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleOpenModal(user)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit User"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(user)}
                        disabled={user.role === 'admin'}
                        className={`p-1.5 rounded-lg transition-colors ${
                          user.role === 'admin' 
                            ? 'text-gray-300 cursor-not-allowed' 
                            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                        }`}
                        title={user.role === 'admin' ? "Administrator tidak dapat dihapus" : "Hapus User"}
                      >
                        <Trash2 className="w-4 h-4" />
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

      {/* Modal Add/Edit User */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800">
                {editingUser ? 'Edit User' : 'Tambah User Baru'}
              </h2>
              <button 
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">NIK</label>
                <input
                  type="text"
                  required
                  disabled={!!editingUser}
                  value={formData.nik}
                  onChange={(e) => setFormData({...formData, nik: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#009B4F] outline-none disabled:bg-gray-100 disabled:text-gray-500"
                  placeholder="Masukkan NIK"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#009B4F] outline-none"
                  placeholder="Masukkan Nama Lengkap"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value as 'admin'|'user'})}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#009B4F] outline-none bg-white"
                  >
                    <option value="user">User</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({...formData, status: e.target.value as 'active'|'inactive'})}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#009B4F] outline-none bg-white"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editingUser && <span className="text-xs text-gray-400 font-normal">(Kosongkan jika tidak ingin mengubah)</span>}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  minLength={6}
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#009B4F] outline-none"
                  placeholder={editingUser ? "••••••••" : "Masukkan Password (min. 6 karakter)"}
                />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#009B4F] hover:bg-[#008543] text-white rounded-lg font-medium transition-colors shadow-sm cursor-pointer"
                >
                  Simpan Data
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-500">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">Perhatian</h3>
                <p className="text-sm text-gray-500">{alertMessage}</p>
              </div>
              <button
                onClick={() => setAlertMessage(null)}
                className="w-full mt-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmUser && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-500">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">Hapus User</h3>
                <p className="text-sm text-gray-500">
                  Apakah Anda yakin ingin menghapus user <span className="font-bold text-gray-700">{deleteConfirmUser.name}</span>? Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <div className="w-full flex gap-3 mt-2">
                <button
                  onClick={() => setDeleteConfirmUser(null)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors shadow-sm cursor-pointer"
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
