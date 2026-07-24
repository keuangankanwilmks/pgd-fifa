import { RefreshCw, WifiOff, X } from 'lucide-react';
import { usePWA } from '../contexts/PWAContext';

export function PWAStatus() {
  const { dismissRefresh, isOffline, needRefresh, reloadApp } = usePWA();

  return (
    <>
      {isOffline && (
        <div
          className="fixed inset-x-0 top-0 z-[100] flex min-h-11 items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950 shadow-md"
          style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
          role="status"
        >
          <WifiOff className="h-4 w-4 shrink-0" />
          Anda sedang offline. Koneksi internet diperlukan untuk memuat dan menyimpan data.
        </div>
      )}

      {needRefresh && (
        <div className="fixed bottom-4 right-4 z-[100] w-[calc(100%-2rem)] max-w-sm rounded-lg border border-emerald-200 bg-white p-4 shadow-2xl fifa-modal-panel fifa-modal-open">
          <button
            type="button"
            onClick={dismissRefresh}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Tutup pemberitahuan pembaruan"
            title="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="pr-8 text-sm font-bold text-gray-900">Versi baru FIFA tersedia</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Muat ulang untuk menggunakan pembaruan terbaru.
          </p>
          <button
            type="button"
            onClick={() => void reloadApp()}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#009B4F] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#008744]"
          >
            <RefreshCw className="h-4 w-4" />
            Muat Ulang
          </button>
        </div>
      )}
    </>
  );
}
