import React, { useState } from 'react';
import { Scale, Lock, User as UserIcon, ArrowRight } from 'lucide-react';
import { User } from '../App';
import toast from 'react-hot-toast';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

import { Logo } from '../components/Logo';

interface LoginProps {
  onLogin: (user: User) => void;
  users: User[];
}

export function Login({ onLogin, users }: LoginProps) {
  const [nik, setNik] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      toast.success('Berhasil masuk dengan Google');
    } catch (error: any) {
      console.error('Google login error:', error);
      toast.error('Gagal masuk dengan Google');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // 1. Check Firestore first for the user record
      const q = query(collection(db, 'users'), where('nik', '==', nik), limit(1));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setError('NIK tidak terdaftar.');
        toast.error('NIK tidak terdaftar.');
        return;
      }

      const userData = querySnapshot.docs[0].data() as User;
      
      if (userData.status === 'inactive') {
        setError('Akun Anda tidak aktif. Silakan hubungi Administrator.');
        toast.error('Akun Anda tidak aktif.');
        return;
      }

      // 2. Attempt Firebase Auth login
      // Virtual email: nik@fifa.local
      const email = userData.email || `${nik}@fifa.local`;
      
      try {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success(`Selamat datang, ${userData.name}!`);
        onLogin(userData);
      } catch (authError: any) {
        console.error('Auth login error:', authError);
        if (authError.code === 'auth/wrong-password' || authError.code === 'auth/user-not-found' || authError.code === 'auth/invalid-credential') {
          setError('Password salah.');
          toast.error('Password salah.');
        } else {
          setError('Gagal masuk ke sistem autentikasi.');
          toast.error('Gagal masuk ke sistem autentikasi.');
        }
      }
    } catch (error: any) {
      console.error('Login error:', error);
      setError('Terjadi kesalahan saat masuk.');
      toast.error('Terjadi kesalahan saat masuk.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50 font-sans">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#005245] flex-col justify-between p-12 relative overflow-hidden">
        {/* Background Decoration */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-10">
          <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] rounded-full bg-gradient-to-br from-[#C4D600] to-transparent blur-3xl"></div>
          <div className="absolute bottom-[10%] -right-[20%] w-[80%] h-[80%] rounded-full bg-gradient-to-tl from-[#009B4F] to-transparent blur-3xl"></div>
        </div>

        <div className="relative z-10">
          <Logo className="w-64 h-64 mb-6" />
          
          <div className="space-y-6">
            <h2 className="text-5xl font-bold text-white leading-tight">
              Financial<br />Integrated<br />Flow Application
            </h2>
            <p className="text-emerald-100/80 text-lg max-w-md leading-relaxed">
              Sistem informasi terintegrasi untuk pengelolaan arus keuangan, rekonsiliasi bank, dan modal kerja yang efisien dan akurat.
            </p>
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-sm text-emerald-400/60 font-medium">
            &copy; 2026 Kanwil VI SulSelBarRa Maluku
          </p>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 sm:p-12 lg:p-24 bg-white">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8">
            <Logo className="w-24 h-24" />
          </div>

          <div className="mb-10">
            <h2 className="text-3xl font-bold text-gray-800 mb-2">Selamat Datang</h2>
            <p className="text-gray-500">Silakan masuk menggunakan NIK dan Password Anda.</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded-r-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nomor Induk Karyawan (NIK)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <UserIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={nik}
                  onChange={(e) => setNik(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#009B4F] focus:border-transparent transition-all outline-none text-gray-800 bg-gray-50 focus:bg-white"
                  placeholder="Masukkan NIK Anda"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#009B4F] focus:border-transparent transition-all outline-none text-gray-800 bg-gray-50 focus:bg-white"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-[#009B4F] hover:bg-[#008543] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#009B4F] transition-all disabled:opacity-50"
            >
              {isLoading ? 'Memproses...' : 'Masuk Aplikasi'}
              {!isLoading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-100"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Atau masuk dengan</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-200 rounded-xl shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#009B4F] transition-all disabled:opacity-50"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                Masuk dengan Google
              </button>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-500">
              Lupa password? Silakan hubungi Administrator IT.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
