import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

interface PWAContextValue {
  canInstall: boolean;
  installApp: () => Promise<boolean>;
  isIos: boolean;
  isOffline: boolean;
  isStandalone: boolean;
  needRefresh: boolean;
  dismissRefresh: () => void;
  reloadApp: () => Promise<void>;
}

const PWAContext = createContext<PWAContextValue | null>(null);

function detectStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((window.navigator as NavigatorWithStandalone).standalone);
}

function detectIos() {
  const userAgent = window.navigator.userAgent;
  const classicIos = /iPad|iPhone|iPod/.test(userAgent);
  const desktopModeIpad = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return classicIos || desktopModeIpad;
}

export function PWAProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(detectStandalone);
  const [isOffline, setIsOffline] = useState(() => !window.navigator.onLine);
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const isIos = detectIos();

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const handleDisplayMode = () => setIsStandalone(detectStandalone());

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    displayMode.addEventListener('change', handleDisplayMode);

    updateSWRef.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true),
      onRegisterError: (error) => console.error('PWA service worker gagal didaftarkan:', error),
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      displayMode.removeEventListener('change', handleDisplayMode);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return choice.outcome === 'accepted';
  }, [deferredPrompt]);

  const reloadApp = useCallback(async () => {
    if (!updateSWRef.current) return;
    await updateSWRef.current(true);
  }, []);

  return (
    <PWAContext.Provider
      value={{
        canInstall: !isStandalone && (Boolean(deferredPrompt) || isIos),
        installApp,
        isIos,
        isOffline,
        isStandalone,
        needRefresh,
        dismissRefresh: () => setNeedRefresh(false),
        reloadApp,
      }}
    >
      {children}
    </PWAContext.Provider>
  );
}

export function usePWA() {
  const context = useContext(PWAContext);
  if (!context) throw new Error('usePWA harus digunakan di dalam PWAProvider');
  return context;
}
