import React, { useEffect, useState } from 'react';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { Globe, ExternalLink, Monitor, LayoutGrid } from 'lucide-react';

interface DashboardProps {
  onAppClick: (appId: string) => void;
}

export function Dashboard({ onAppClick }: DashboardProps) {
  const [apps, setApps] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) {
      setApps([]);
      setIsLoading(false);
      return;
    }
    
    const path = 'supporting_apps';
    const unsub = onSnapshot(collection(db, path), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort by order
      setApps(data.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)));
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      setIsLoading(false);
    });
    return () => unsub();
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 tracking-tight">Halaman Utama</h1>
          <p className="text-gray-500 mt-1 font-medium">Daftar Aplikasi Supporting Finance</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500 bg-white px-5 py-2.5 rounded-full shadow-sm border border-gray-100">
          <div className="w-2 h-2 rounded-full bg-[#65B32E] animate-pulse"></div>
          <span className="font-semibold text-gray-700">Sistem Aktif</span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-[#009B4F]/20 border-t-[#009B4F] rounded-full animate-spin"></div>
            <p className="text-gray-500 font-medium">Memuat daftar aplikasi...</p>
          </div>
        </div>
      ) : apps.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <LayoutGrid className="w-10 h-10 text-gray-300" />
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">Belum Ada Aplikasi</h3>
          <p className="text-gray-500 max-w-md">Silakan tambahkan aplikasi melalui menu Setting &gt; Supporting App untuk menampilkannya di sini.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {apps.map((app) => (
            <a
              key={app.id}
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-white rounded-2xl p-8 shadow-sm border border-gray-100 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-[#009B4F]/30 text-center flex flex-col items-center cursor-pointer"
            >
              <div className="relative mb-6">
                {/* Badge Border Effect */}
                <div className="absolute inset-0 -m-3 rounded-full border-2 border-dashed border-gray-100 group-hover:border-[#009B4F]/30 group-hover:rotate-45 transition-all duration-700"></div>
                
                <div className="w-24 h-24 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shadow-inner group-hover:scale-110 transition-transform duration-300 relative z-10">
                  {app.logo ? (
                    <img 
                      src={app.logo} 
                      alt={app.label} 
                      className="w-full h-full object-contain p-2"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Monitor className="w-10 h-10 text-gray-300 group-hover:text-[#009B4F] transition-colors" />
                  )}
                </div>
              </div>
              
              <h3 className="text-xl font-bold text-gray-800 group-hover:text-[#009B4F] transition-colors mb-2">{app.label}</h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Buka Aplikasi</span>
                <ExternalLink className="w-3 h-3" />
              </div>

              {/* Decorative corner accent */}
              <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden rounded-tr-2xl">
                <div className="absolute top-0 right-0 w-8 h-8 bg-[#009B4F]/5 -rotate-45 translate-x-4 -translate-y-4 group-hover:bg-[#009B4F]/10 transition-colors"></div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
