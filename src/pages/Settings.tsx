import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, Edit2, Globe, Link as LinkIcon, Loader2, Database, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { cabangService } from '../services/cabangService';
import { norekService } from '../services/norekService';

interface AppLink {
  id: string;
  label: string;
  url: string;
  logo?: string;
  order: number;
}

interface SettingsProps {
  type: 'supporting-apps' | 'general';
}

export function Settings({ type }: SettingsProps) {
  const [apps, setApps] = useState<AppLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentApp, setCurrentApp] = useState<AppLink | null>(null);
  const [newApp, setNewApp] = useState({ label: '', url: '', logo: '' });
  const [isDeleting, setIsDeleting] = useState(false);
  const [appToDelete, setAppToDelete] = useState<string | null>(null);

  useEffect(() => {
    const path = 'supporting_apps';
    const unsub = onSnapshot(collection(db, path), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AppLink[];
      // Sort by order
      setApps(data.sort((a, b) => (a.order || 0) - (b.order || 0)));
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      setIsLoading(false);
    });

    return () => unsub();
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500 * 1024) { // 500KB limit
        toast.error('Ukuran logo maksimal 500KB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        if (isEdit && currentApp) {
          setCurrentApp({ ...currentApp, logo: base64String });
        } else {
          setNewApp({ ...newApp, logo: base64String });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAdd = async () => {
    if (!auth.currentUser) {
      toast.error('Anda harus masuk dengan Google untuk menambah aplikasi');
      return;
    }

    if (!newApp.label || !newApp.url) {
      toast.error('Label dan URL harus diisi');
      return;
    }
    
    const path = 'supporting_apps';
    try {
      await addDoc(collection(db, path), {
        label: newApp.label,
        url: newApp.url,
        logo: newApp.logo,
        order: apps.length
      });
      setNewApp({ label: '', url: '', logo: '' });
      setIsAdding(false);
      toast.success('Aplikasi berhasil ditambahkan');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const handleUpdate = async () => {
    if (!currentApp) return;
    
    const path = `supporting_apps/${currentApp.id}`;
    try {
      await updateDoc(doc(db, 'supporting_apps', currentApp.id), {
        label: currentApp.label,
        url: currentApp.url,
        logo: currentApp.logo || ''
      });
      setIsEditing(false);
      setCurrentApp(null);
      toast.success('Aplikasi berhasil diperbarui');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleDelete = (id: string) => {
    setAppToDelete(id);
    setIsDeleting(true);
  };

  const confirmDelete = async () => {
    if (!appToDelete) return;
    
    if (!auth.currentUser) {
      toast.error('Anda harus masuk dengan Google untuk menghapus aplikasi');
      setIsDeleting(false);
      setAppToDelete(null);
      return;
    }
    
    const path = `supporting_apps/${appToDelete}`;
    try {
      await deleteDoc(doc(db, 'supporting_apps', appToDelete));
      toast.success('Aplikasi berhasil dihapus');
      setIsDeleting(false);
      setAppToDelete(null);
    } catch (error) {
      console.error('Delete error:', error);
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedCabang = async () => {
    setIsSeeding(true);
    try {
      await cabangService.seed();
      toast.success('Data Cabang berhasil di-seed ke Firebase');
    } catch (error) {
      console.error('Seed error:', error);
      toast.error('Gagal melakukan seeding data cabang');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleSeedNorek = async () => {
    setIsSeeding(true);
    try {
      await norekService.seed();
      toast.success('Data Nomor Rekening berhasil di-seed ke Firebase');
    } catch (error) {
      console.error('Seed error:', error);
      toast.error('Gagal melakukan seeding data nomor rekening');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= apps.length) return;

    const updatedApps = [...apps];
    const temp = updatedApps[index];
    updatedApps[index] = updatedApps[newIndex];
    updatedApps[newIndex] = temp;

    // Update orders in Firestore
    const loadingToast = toast.loading('Memperbarui urutan...');
    try {
      await Promise.all([
        updateDoc(doc(db, 'supporting_apps', updatedApps[index].id), { order: index }),
        updateDoc(doc(db, 'supporting_apps', updatedApps[newIndex].id), { order: newIndex })
      ]);
      toast.success('Urutan berhasil diperbarui', { id: loadingToast });
    } catch (error) {
      console.error('Order update error:', error);
      toast.error('Gagal memperbarui urutan', { id: loadingToast });
    }
  };

  if (type === 'general') {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-emerald-50 rounded-lg text-[#009B4F]">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Manajemen Data</h2>
              <p className="text-sm text-gray-500">Kelola data master aplikasi.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 border border-gray-100 rounded-xl bg-gray-50/50">
              <h3 className="font-semibold text-gray-800 mb-2">Data Cabang & Area</h3>
              <p className="text-sm text-gray-500 mb-4">
                Sinkronisasi data master cabang dan area ke database Firebase. Gunakan ini jika data cabang di report tidak muncul atau perlu diperbarui.
              </p>
              <button
                onClick={handleSeedCabang}
                disabled={isSeeding}
                className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSeeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Seed Data Cabang
              </button>
            </div>

            <div className="p-4 border border-gray-100 rounded-xl bg-gray-50/50">
              <h3 className="font-semibold text-gray-800 mb-2">Data Nomor Rekening</h3>
              <p className="text-sm text-gray-500 mb-4">
                Sinkronisasi data master nomor rekening ke database Firebase. Berguna untuk pemetaan otomatis saat proses rekonsiliasi.
              </p>
              <button
                onClick={handleSeedNorek}
                disabled={isSeeding}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSeeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Seed Data Norek
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Pengaturan Supporting Apps</h2>
            <p className="text-sm text-gray-500">Kelola aplikasi eksternal yang akan di-embed ke dalam FIFA.</p>
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tambah Aplikasi
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-16 text-center">Urutan</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nama Aplikasi</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">URL / Link</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {apps.map((app, index) => (
                <tr key={app.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <button 
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-[#009B4F] disabled:opacity-20 cursor-pointer"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === apps.length - 1}
                        className="p-1 text-gray-400 hover:text-[#009B4F] disabled:opacity-20 cursor-pointer"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-[#009B4F]">
                        <Globe className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-gray-700">{app.label}</span>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <LinkIcon className="w-3 h-3" />
                      <span className="truncate max-w-xs">{app.url}</span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => {
                          setCurrentApp(app);
                          setIsEditing(true);
                        }}
                        className="p-2 text-gray-400 hover:text-blue-500 transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(app.id)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(isAdding || isEditing) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800">
                {isEditing ? 'Edit Supporting App' : 'Tambah Supporting App'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-col items-center mb-4">
                <div className="w-20 h-20 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden mb-2">
                  {(isEditing ? currentApp?.logo : newApp.logo) ? (
                    <img 
                      src={isEditing ? currentApp?.logo : newApp.logo} 
                      alt="Logo Preview" 
                      className="w-full h-full object-contain p-2"
                    />
                  ) : (
                    <Globe className="w-8 h-8 text-gray-300" />
                  )}
                </div>
                <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                  Upload Logo
                  <input 
                    type="file" 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => handleLogoUpload(e, isEditing)}
                  />
                </label>
                <p className="text-[10px] text-gray-400 mt-1">Max 500KB</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Aplikasi</label>
                <input 
                  type="text" 
                  value={isEditing ? currentApp?.label : newApp.label}
                  onChange={(e) => isEditing 
                    ? setCurrentApp(prev => prev ? {...prev, label: e.target.value} : null)
                    : setNewApp({...newApp, label: e.target.value})
                  }
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all"
                  placeholder="Contoh: Stream"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL Aplikasi</label>
                <input 
                  type="text" 
                  value={isEditing ? currentApp?.url : newApp.url}
                  onChange={(e) => isEditing
                    ? setCurrentApp(prev => prev ? {...prev, url: e.target.value} : null)
                    : setNewApp({...newApp, url: e.target.value})
                  }
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all"
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="p-6 bg-gray-50 flex items-center justify-end gap-3">
              <button 
                onClick={() => {
                  setIsAdding(false);
                  setIsEditing(false);
                  setCurrentApp(null);
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button 
                onClick={isEditing ? handleUpdate : handleAdd}
                className="px-6 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-colors font-medium cursor-pointer"
              >
                {isEditing ? 'Perbarui' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeleting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500 mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Hapus Aplikasi?</h3>
              <p className="text-gray-500">Tindakan ini tidak dapat dibatalkan. Apakah Anda yakin ingin menghapus aplikasi ini?</p>
            </div>
            <div className="p-6 bg-gray-50 flex items-center justify-center gap-3">
              <button 
                onClick={() => {
                  setIsDeleting(false);
                  setAppToDelete(null);
                }}
                className="px-6 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer font-medium"
              >
                Batal
              </button>
              <button 
                onClick={confirmDelete}
                className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium cursor-pointer"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
