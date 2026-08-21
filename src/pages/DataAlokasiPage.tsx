import { useState } from 'react';
import { FileCheck2, Table2 } from 'lucide-react';
import { AllocationApprovalPanel } from '../components/AllocationApprovalPanel';
import { DataAlokasi, type DataAlokasiProps } from './DataAlokasi';

type TabId = 'data' | 'approval';

export function DataAlokasiPage(props: DataAlokasiProps) {
  const [activeTab, setActiveTab] = useState<TabId>('data');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex w-fit rounded-lg bg-gray-100 p-1">
        {([
          { id: 'data' as const, label: 'Data Alokasi', icon: Table2 },
          { id: 'approval' as const, label: 'Dokumen Persetujuan', icon: FileCheck2 },
        ]).map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex h-10 min-w-[180px] cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-xs font-bold transition-colors ${activeTab === tab.id ? 'bg-white text-[#009B4F] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'data'
        ? <DataAlokasi {...props} />
        : <AllocationApprovalPanel {...props} />}
    </div>
  );
}

