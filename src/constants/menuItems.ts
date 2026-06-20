import { Home, Briefcase, Landmark, FileText, Settings, BarChart3 } from 'lucide-react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: any;
  subItems?: MenuItem[];
  isParent?: boolean;
  children?: MenuItem[];
}

export interface FlatMenuItem {
  id: string;
  label: string;
  parentLabel?: string;
}

export interface RoleAccessConfig {
  id: string;
  label: string;
  menuIds: string[];
  databasePermissions?: any;
}

export type RoleAccessMap = Record<string, string[]>;

export const normalizeRoleId = (role: string) => role.trim().toLowerCase();

export const BASE_MENU_ITEMS: MenuItem[] = [
  { id: 'dashboard', label: 'Halaman Utama', icon: Home },
  {
    id: 'moker',
    label: 'Modal Kerja',
    icon: Briefcase,
    subItems: [
      { id: 'proses-moker', label: 'Proses Moker' },
      { id: 'data-moker', label: 'Data Moker' },
    ],
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
          { id: 'data-rekon-bni', label: 'Data Rekon' },
        ],
      },
      {
        id: 'rekon-bri-parent',
        label: 'BRI',
        isParent: true,
        children: [
          { id: 'rekon-bri', label: 'Proses Rekon' },
          { id: 'data-rekon-bri', label: 'Data Rekon' },
        ],
      },
      {
        id: 'rekon-bsi-parent',
        label: 'BSI',
        isParent: true,
        children: [
          { id: 'rekon-bsi', label: 'Proses Rekon' },
          { id: 'data-rekon-bsi', label: 'Data Rekon' },
        ],
      },
      { id: 'saldo-harian', label: 'Saldo Harian' },
    ],
  },
  { id: 'hutang', label: 'Hutang Operasional Lain', icon: FileText },
  { id: 'report', label: 'Report', icon: BarChart3 },
  {
    id: 'settings',
    label: 'Setting',
    icon: Settings,
    subItems: [
      { id: 'setting-supporting-apps', label: 'Supporting App' },
      { id: 'setting-general', label: 'Manajemen Data' },
      { id: 'setting-upload-excel', label: 'Set Upload Excel' },
      { id: 'setting-template-blast', label: 'Template Blast Email' },
      { id: 'setting-template-blast-whatsapp', label: 'Template Blast WhatsApp' },
      { id: 'user-management', label: 'Manajemen User' },
    ],
  },
];

export const getAllMenuItems = () => BASE_MENU_ITEMS;

export const flattenMenuItems = (items: MenuItem[]): FlatMenuItem[] => {
  const flat: FlatMenuItem[] = [];

  const walk = (itemList: MenuItem[], parentLabel?: string) => {
    itemList.forEach(item => {
      const nextParentLabel = parentLabel ? `${parentLabel} > ${item.label}` : item.label;

      if (item.subItems) {
        walk(item.subItems, nextParentLabel);
        return;
      }

      if (item.children) {
        walk(item.children, nextParentLabel);
        return;
      }

      flat.push({ id: item.id, label: item.label, parentLabel });
    });
  };

  walk(items);
  return flat;
};

export const getAllLeafMenuItems = () => flattenMenuItems(BASE_MENU_ITEMS);

export const DEFAULT_ROLE_ACCESS_CONFIGS: RoleAccessConfig[] = [
  {
    id: 'admin',
    label: 'Administrator',
    menuIds: getAllLeafMenuItems().map(item => item.id),
  },
  {
    id: 'user',
    label: 'User',
    menuIds: getAllLeafMenuItems()
      .filter(item => ![
        'setting-supporting-apps',
        'setting-general',
        'setting-upload-excel',
        'setting-template-blast',
        'setting-template-blast-whatsapp',
        'user-management',
      ].includes(item.id))
      .map(item => item.id),
  },
  {
    id: 'guest',
    label: 'Guest',
    menuIds: ['dashboard', 'report'],
  },
];

export const getDefaultMenuIdsForRole = (role: string) => (
  DEFAULT_ROLE_ACCESS_CONFIGS.find(config => config.id === normalizeRoleId(role))?.menuIds || ['dashboard']
);

const filterMenuTree = (items: MenuItem[], allowedIds: Set<string>): MenuItem[] => {
  return items.reduce<MenuItem[]>((acc, item) => {
    if (item.subItems) {
      const subItems = filterMenuTree(item.subItems, allowedIds);
      if (subItems.length > 0) {
        acc.push({ ...item, subItems });
      }
      return acc;
    }

    if (item.children) {
      const children = filterMenuTree(item.children, allowedIds);
      if (children.length > 0) {
        acc.push({ ...item, children });
      }
      return acc;
    }

    if (allowedIds.has(item.id)) {
      acc.push(item);
    }
    return acc;
  }, []);
};

export const getMenuItems = (role: string, roleAccessMap: RoleAccessMap = {}): MenuItem[] => {
  const normalizedRole = normalizeRoleId(role);
  if (normalizedRole === 'admin') {
    return BASE_MENU_ITEMS;
  }

  const allowedIds = new Set(roleAccessMap[role] || roleAccessMap[normalizedRole] || getDefaultMenuIdsForRole(normalizedRole));
  return filterMenuTree(BASE_MENU_ITEMS, allowedIds);
};

export const isMenuAllowed = (role: string, menuId: string, roleAccessMap: RoleAccessMap = {}) => {
  const normalizedRole = normalizeRoleId(role);
  if (normalizedRole === 'admin') return true;
  const allowedIds = roleAccessMap[role] || roleAccessMap[normalizedRole] || getDefaultMenuIdsForRole(normalizedRole);
  return allowedIds.includes(menuId);
};

export const getRoleLabel = (role: string, configs: RoleAccessConfig[] = DEFAULT_ROLE_ACCESS_CONFIGS) => {
  const normalizedRole = normalizeRoleId(role);
  return configs.find(config => config.id === role || config.id === normalizedRole)?.label || role;
};

export const mergeRoleAccessConfigs = (configs: RoleAccessConfig[]) => {
  const map = new Map<string, RoleAccessConfig>();
  DEFAULT_ROLE_ACCESS_CONFIGS.forEach(config => {
    map.set(config.id, config);
  });

  configs.forEach(config => {
    map.set(config.id, {
      ...config,
      label: config.label || config.id,
      menuIds: Array.isArray(config.menuIds) ? config.menuIds : [],
      databasePermissions: config.databasePermissions,
    });
  });

  return Array.from(map.values());
};
