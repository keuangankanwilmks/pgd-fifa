import React, { useState } from 'react';
import { Scale, Lock, User as UserIcon, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { User } from '../App';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { signInWithCustomToken } from 'firebase/auth';

import { Logo } from '../components/Logo';

interface LoginProps {
  onLogin: (user: User) => void;
  users: User[];
}

export function Login({ onLogin, users }: LoginProps) {
  const [nik, setNik] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nik: nik.trim(), password }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.customToken || !data?.user) {
        throw new Error(data?.error || 'NIK atau password tidak valid');
      }

      await signInWithCustomToken(auth, data.customToken);
      toast.success(`Selamat datang, ${data.user.name}!`);
      onLogin(data.user as User);
    } catch (error: any) {
      console.error('Login error:', error);
      const message = error?.message || 'Terjadi kesalahan saat masuk.';
      setError(message);
      toast.error(message);
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
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#009B4F] focus:border-transparent transition-all outline-none text-gray-800 bg-gray-50 focus:bg-white"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
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
