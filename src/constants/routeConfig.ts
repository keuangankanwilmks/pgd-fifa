
export const TAB_TO_PATH: Record<string, string> = {
  'dashboard': '/',
  'proses-moker': '/modal-kerja/proses-moker',
  'data-moker': '/modal-kerja/data-moker',
  'rekon-bni': '/rekonsiliasi-bank/bni/proses-rekon',
  'data-rekon-bni': '/rekonsiliasi-bank/bni/data-rekon',
  'rekon-bri': '/rekonsiliasi-bank/bri/proses-rekon',
  'data-rekon-bri': '/rekonsiliasi-bank/bri/data-rekon',
  'rekon-bsi': '/rekonsiliasi-bank/bsi/proses-rekon',
  'data-rekon-bsi': '/rekonsiliasi-bank/bsi/data-rekon',
  'saldo-harian': '/rekonsiliasi-bank/saldo-harian',
  'hutang': '/hutang-operasional',
  'report': '/report',
  'user-management': '/settings/user-management',
  'setting-supporting-apps': '/settings/supporting-apps',
  'setting-general': '/settings/manajemen-data',
  'setting-upload-excel': '/settings/set-upload-excel',
  'setting-template-blast': '/settings/template-blast',
  'setting-template-blast-whatsapp': '/settings/template-blast-whatsapp',
};

export const PATH_TO_TAB: Record<string, string> = Object.entries(TAB_TO_PATH).reduce((acc, [tab, path]) => {
  acc[path] = tab;
  return acc;
}, {} as Record<string, string>);

export const getTabFromPath = (path: string): string => {
  if (path === '/') return 'dashboard';
  if (path.startsWith('/supporting-app/')) {
    const id = path.replace('/supporting-app/', '');
    return `support-${id}`;
  }
  return PATH_TO_TAB[path] || 'dashboard';
};

export const getPathFromTab = (tab: string): string => {
  if (tab.startsWith('support-')) {
    const id = tab.replace('support-', '');
    return `/supporting-app/${id}`;
  }
  return TAB_TO_PATH[tab] || '/';
};
