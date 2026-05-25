import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Mail, Save, User as UserIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { User } from '../App';
import { auth, db } from '../firebase';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { AnimatedModal } from './AnimatedModal';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  currentUser: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function ProfileSettingsModal({ isOpen, currentUser, onClose, onUpdated }: ProfileSettingsModalProps) {
  const [formData, setFormData] = useState({
    nik: currentUser.nik || '',
    name: currentUser.name || '',
    email: currentUser.email || '',
    newPassword: '',
    confirmPassword: '',
    currentPassword: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  useEscapeToClose(isOpen && !isSaving, onClose);

  useEffect(() => {
    if (!isOpen) return;
    setFormData({
      nik: currentUser.nik || '',
      name: currentUser.name || '',
      email: currentUser.email || auth.currentUser?.email || '',
      newPassword: '',
      confirmPassword: '',
      currentPassword: '',
    });
  }, [currentUser, isOpen]);

  const isGuest = currentUser.role === 'guest' || !auth.currentUser;
  const hasChanges = useMemo(() => {
    const nextNik = formData.nik.trim();
    const nextName = formData.name.trim();
    const nextEmail = formData.email.trim();

    return nextNik !== (currentUser.nik || '') ||
      nextName !== (currentUser.name || '') ||
      nextEmail !== (currentUser.email || auth.currentUser?.email || '') ||
      !!formData.newPassword;
  }, [currentUser, formData]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isGuest || !auth.currentUser) {
      toast.error('Akun tamu tidak dapat mengubah profil');
      return;
    }

    const nextNik = formData.nik.trim();
    const nextName = formData.name.trim();
    const nextEmail = formData.email.trim();

    if (!nextNik || !nextName || !nextEmail) {
      toast.error('NIK, Nama, dan Email wajib diisi');
      return;
    }

    if (!isValidEmail(nextEmail)) {
      toast.error('Format email belum valid');
      return;
    }

    if (!hasChanges) {
      toast('Tidak ada perubahan profil');
      return;
    }

    if (!formData.currentPassword) {
      toast.error('Masukkan password saat ini untuk konfirmasi perubahan profil');
      return;
    }

    if (formData.newPassword && formData.newPassword.length < 6) {
      toast.error('Password baru minimal 6 karakter');
      return;
    }

    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      toast.error('Konfirmasi password baru tidak sama');
      return;
    }

    setIsSaving(true);
    try {
      const firebaseUser = auth.currentUser;
      const credential = EmailAuthProvider.credential(firebaseUser.email || currentUser.email || nextEmail, formData.currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);

      const duplicateNik = await getDocs(query(collection(db, 'users'), where('nik', '==', nextNik)));
      const hasDuplicateNik = duplicateNik.docs.some(item => item.id !== firebaseUser.uid);
      if (hasDuplicateNik) {
        toast.error('NIK sudah digunakan oleh user lain');
        return;
      }

      if (nextEmail !== (firebaseUser.email || '')) {
        await updateEmail(firebaseUser, nextEmail);
      }

      if (formData.newPassword) {
        await updatePassword(firebaseUser, formData.newPassword);
      }

      await updateProfile(firebaseUser, { displayName: nextName });

      const updatedUser: User = {
        ...currentUser,
        uid: firebaseUser.uid,
        nik: nextNik,
        name: nextName,
        email: nextEmail,
      };

      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        nik: nextNik,
        name: nextName,
        email: nextEmail,
        uid: firebaseUser.uid,
      });

      onUpdated(updatedUser);
      toast.success('Profil berhasil diperbarui');
      onClose();
    } catch (error: any) {
      console.error('Profile update error:', error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        toast.error('Password konfirmasi salah');
      } else if (error.code === 'auth/email-already-in-use') {
        toast.error('Email sudah digunakan oleh user lain');
      } else if (error.code === 'auth/requires-recent-login') {
        toast.error('Sesi login perlu diperbarui. Silakan logout lalu login kembali.');
      } else if (error.code === 'auth/provider-already-linked' || error.code === 'auth/operation-not-allowed') {
        toast.error('Metode login akun ini tidak mendukung perubahan password melalui aplikasi');
      } else {
        toast.error('Gagal memperbarui profil');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatedModal isOpen={isOpen} className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/70 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#009B4F]">
              <UserIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-800">Profil Setting</h2>
              <p className="text-xs text-gray-500">Kelola informasi akun FIFA Anda.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {isGuest && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Akun tamu tidak memiliki profil tersimpan, sehingga tidak dapat mengubah data user.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold text-gray-700">NIK</label>
              <input
                value={formData.nik}
                onChange={(event) => setFormData(prev => ({ ...prev, nik: event.target.value }))}
                disabled={isSaving || isGuest}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="NIK"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-gray-700">Nama</label>
              <input
                value={formData.name}
                onChange={(event) => setFormData(prev => ({ ...prev, name: event.target.value }))}
                disabled={isSaving || isGuest}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="Nama lengkap"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-bold text-gray-700">
              <Mail className="h-4 w-4 text-gray-400" />
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(event) => setFormData(prev => ({ ...prev, email: event.target.value }))}
              disabled={isSaving || isGuest}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 disabled:bg-gray-100 disabled:text-gray-500"
              placeholder="email@domain.com"
            />
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <label className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
              <KeyRound className="h-4 w-4 text-[#009B4F]" />
              Ubah Password
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="password"
                value={formData.newPassword}
                onChange={(event) => setFormData(prev => ({ ...prev, newPassword: event.target.value }))}
                disabled={isSaving || isGuest}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="Password baru"
              />
              <input
                type="password"
                value={formData.confirmPassword}
                onChange={(event) => setFormData(prev => ({ ...prev, confirmPassword: event.target.value }))}
                disabled={isSaving || isGuest}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="Konfirmasi password baru"
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">Kosongkan jika tidak ingin mengganti password.</p>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-bold text-gray-700">
              <KeyRound className="h-4 w-4 text-gray-400" />
              Password Saat Ini <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formData.currentPassword}
              onChange={(event) => setFormData(prev => ({ ...prev, currentPassword: event.target.value }))}
              disabled={isSaving || isGuest}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20 disabled:bg-gray-100 disabled:text-gray-500"
              placeholder="Wajib diisi untuk menyimpan perubahan"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg px-4 py-2 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSaving || isGuest}
              className="flex items-center gap-2 rounded-lg bg-[#009B4F] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#008543] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? 'Menyimpan...' : 'Simpan Profil'}
            </button>
          </div>
        </form>
      </div>
    </AnimatedModal>
  );
}
