import { Home, Briefcase, Landmark, FileText, Settings, BarChart3 } from 'lucide-react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: any;
  subItems?: MenuItem[];
  isParent?: boolean;
  children?: MenuItem[];
}

export const getMenuItems = (role: 'admin' | 'user'): MenuItem[] => [
  { id: 'dashboard', label: 'Halaman Utama', icon: Home },
  { 
    id: 'moker', 
    label: 'Modal Kerja', 
    icon: Briefcase,
    subItems: [
      { id: 'proses-moker', label: 'Proses Moker' },
      { id: 'data-moker', label: 'Data Moker' }
    ]
  },
  { 
    id: 'rekonsiliasi', 
    label: 'Rekonsiliasi Bank', 
    icon: Landmark,
    subItems: [
      { 
        id: 'rekon-bni-parent', 
        label: 'BNI',
        isParent: true,
        children: [
          { id: 'rekon-bni', label: 'Proses Rekon' },
          { id: 'data-rekon-bni', label: 'Data Rekon' }
        ]
      },
      { 
        id: 'rekon-bri-parent', 
        label: 'BRI',
        isParent: true,
        children: [
          { id: 'rekon-bri', label: 'Proses Rekon' },
          { id: 'data-rekon-bri', label: 'Data Rekon' }
        ]
      },
      { 
        id: 'rekon-bsi-parent', 
        label: 'BSI',
        isParent: true,
        children: [
          { id: 'rekon-bsi', label: 'Proses Rekon' },
          { id: 'data-rekon-bsi', label: 'Data Rekon' }
        ]
      }
    ]
  },
  { id: 'hutang', label: 'Hutang Operasional Lain', icon: FileText },
  { id: 'report', label: 'Report', icon: BarChart3 },
  ...(role === 'admin' ? [{
    id: 'settings',
    label: 'Setting',
    icon: Settings,
    subItems: [
      { id: 'setting-supporting-apps', label: 'Supporting App' },
      { id: 'setting-general', label: 'Manajemen Data' },
      { id: 'user-management', label: 'Manajemen User' }
    ]
  }] : [])
];

export const flattenMenuItems = (items: MenuItem[]): { id: string; label: string; parentLabel?: string }[] => {
  const flat: { id: string; label: string; parentLabel?: string }[] = [];
  
  items.forEach(item => {
    if (item.subItems) {
      item.subItems.forEach(sub => {
        if (sub.children) {
          sub.children.forEach(child => {
            flat.push({ id: child.id, label: child.label, parentLabel: `${item.label} > ${sub.label}` });
          });
        } else {
          flat.push({ id: sub.id, label: sub.label, parentLabel: item.label });
        }
      });
    } else {
      flat.push({ id: item.id, label: item.label });
    }
  });
  
  return flat;
};
