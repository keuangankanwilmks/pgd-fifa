import { normalizeRoleId } from './menuItems';

export type DatabasePermissionTargetId = 'data-moker' | 'data-rekon' | 'saldo-harian' | 'hutang-operasional' | 'anggaran';
export type DatabasePermissionAction = 'edit' | 'delete';

export interface DatabasePermissionTarget {
  id: DatabasePermissionTargetId;
  label: string;
  description: string;
}

export type DatabasePermissionMap = Record<DatabasePermissionTargetId, Record<DatabasePermissionAction, boolean>>;
export type RoleDatabasePermissionMap = Record<string, Partial<DatabasePermissionMap>>;

export const DATABASE_PERMISSION_TARGETS: DatabasePermissionTarget[] = [
  {
    id: 'data-moker',
    label: 'Data Moker',
    description: 'Data rekap modal kerja pada menu Modal Kerja.',
  },
  {
    id: 'data-rekon',
    label: 'Data Rekon',
    description: 'Database hasil rekon untuk BNI, BRI, dan BSI.',
  },
  {
    id: 'saldo-harian',
    label: 'Saldo Harian',
    description: 'Rekap saldo bank harian.',
  },
  {
    id: 'hutang-operasional',
    label: 'Hutang Operasional Lain',
    description: 'Database Hutang Operasional Lain.',
  },
  {
    id: 'anggaran',
    label: 'Data Alokasi Anggaran',
    description: 'Database alokasi anggaran per tahun dan cabang.',
  },
];

const emptyPermissions = (): DatabasePermissionMap => ({
  'data-moker': { edit: false, delete: false },
  'data-rekon': { edit: false, delete: false },
  'saldo-harian': { edit: false, delete: false },
  'hutang-operasional': { edit: false, delete: false },
  'anggaran': { edit: false, delete: false },
});

export const getFullDatabasePermissions = (): DatabasePermissionMap => ({
  'data-moker': { edit: true, delete: true },
  'data-rekon': { edit: true, delete: true },
  'saldo-harian': { edit: true, delete: true },
  'hutang-operasional': { edit: true, delete: true },
  'anggaran': { edit: true, delete: true },
});

export const getDefaultDatabasePermissionsForRole = (role: string): DatabasePermissionMap => {
  const normalizedRole = normalizeRoleId(role);
  if (normalizedRole === 'admin') return getFullDatabasePermissions();
  if (normalizedRole === 'guest') return emptyPermissions();

  return {
    'data-moker': { edit: true, delete: false },
    'data-rekon': { edit: false, delete: false },
    'saldo-harian': { edit: true, delete: false },
    'hutang-operasional': { edit: true, delete: true },
    'anggaran': { edit: false, delete: false },
  };
};

export const normalizeDatabasePermissions = (
  role: string,
  permissions?: Partial<DatabasePermissionMap>,
): DatabasePermissionMap => {
  const base = getDefaultDatabasePermissionsForRole(role);
  const next = { ...base };

  DATABASE_PERMISSION_TARGETS.forEach(target => {
    next[target.id] = {
      edit: Boolean(permissions?.[target.id]?.edit ?? base[target.id].edit),
      delete: Boolean(permissions?.[target.id]?.delete ?? base[target.id].delete),
    };
  });

  return next;
};

export const canModifyDatabase = (
  role: string | undefined,
  targetId: DatabasePermissionTargetId,
  action: DatabasePermissionAction,
  roleDatabasePermissionMap: RoleDatabasePermissionMap = {},
) => {
  const normalizedRole = normalizeRoleId(role || 'guest');
  if (normalizedRole === 'admin') return true;

  const permissions = roleDatabasePermissionMap[role || ''] || roleDatabasePermissionMap[normalizedRole];
  const normalizedPermissions = normalizeDatabasePermissions(normalizedRole, permissions);
  return Boolean(normalizedPermissions[targetId]?.[action]);
};
