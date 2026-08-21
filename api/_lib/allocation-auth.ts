import { authorizeAppRequest } from './app-auth.js';

export interface AuthorizedAllocationUser {
  uid: string;
  name: string;
  role: string;
  canEdit: boolean;
  canView: boolean;
}

export const authorizeAllocationRequest = async (req: any): Promise<AuthorizedAllocationUser> => {
  const user = await authorizeAppRequest(req);
  const permission = user.databasePermissions?.anggaran || {};

  return {
    uid: user.uid,
    name: user.name,
    role: user.role,
    canEdit: user.isAdmin || permission.edit === true,
    canView: user.isAdmin || user.menuIds.includes('data-alokasi'),
  };
};
