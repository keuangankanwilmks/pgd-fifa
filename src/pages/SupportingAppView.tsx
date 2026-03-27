import React, { useEffect, useState } from 'react';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

interface SupportingAppViewProps {
  tabId: string;
}

export function SupportingAppView({ tabId }: SupportingAppViewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) {
      setUrl('about:blank');
      setIsLoading(false);
      return;
    }

    const fetchUrl = async () => {
      setIsLoading(true);
      const actualId = tabId.startsWith('support-') ? tabId.replace('support-', '') : tabId;
      const path = `supporting_apps/${actualId}`;
      try {
        const docRef = doc(db, 'supporting_apps', actualId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setUrl(docSnap.data().url);
        } else {
          setUrl('about:blank');
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
        setUrl('about:blank');
      } finally {
        setIsLoading(false);
      }
    };
    fetchUrl();
  }, [tabId]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#009B4F] animate-spin" />
          <p className="text-sm text-gray-500">Memuat aplikasi...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Embedded Application</span>
        <a 
          href={url || '#'} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-[#009B4F] hover:underline flex items-center gap-1"
        >
          Buka di Tab Baru
        </a>
      </div>
      <div className="flex-1 relative">
        <iframe 
          src={url || 'about:blank'} 
          className="absolute inset-0 w-full h-full border-none"
          title="Supporting App"
        />
      </div>
    </div>
  );
}
