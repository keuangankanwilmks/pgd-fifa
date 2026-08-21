import { getServerAuth, getServerFirestore } from './google-server';

export interface AuthorizedAppUser {
  uid: string;
  email: string;
  name: string;
  nik: string;
  role: string;
  isAdmin: boolean;
  menuIds: string[];
  databasePermissions: Record<string, { edit?: boolean; delete?: boolean }>;
}

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

const getBearerToken = (req: any) => {
  const authorization = String(req.headers?.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
};

export const authorizeAppRequest = async (req: any): Promise<AuthorizedAppUser> => {
  const token = getBearerToken(req);
  if (!token) throw httpError('Sesi login diperlukan', 401);

  let decoded;
  try {
    decoded = await getServerAuth().verifyIdToken(token, true);
  } catch {
    throw httpError('Sesi login tidak valid atau sudah berakhir', 401);
  }

  const db = getServerFirestore();
  let userSnapshot = await db.collection('users').doc(decoded.uid).get();
  if (!userSnapshot.exists) {
    const legacySnapshot = await db.collection('users').where('uid', '==', decoded.uid).limit(1).get();
    userSnapshot = legacySnapshot.docs[0] || userSnapshot;
  }
  if (!userSnapshot.exists) throw httpError('Akun belum terdaftar di FIFA', 403);

  const user = userSnapshot.data() || {};
  if (user.status !== 'active') throw httpError('Akun user tidak aktif', 403);

  const role = String(user.role || '').trim().toLowerCase();
  if (!role) throw httpError('Role user belum dikonfigurasi', 403);
  const isAdmin = role === 'admin' || decoded.email === 'keuangan.kanwilmks@gmail.com';
  const roleSnapshot = isAdmin ? null : await db.collection('role_access').doc(role).get();
  const roleAccess = roleSnapshot?.data() || {};

  return {
    uid: decoded.uid,
    email: String(decoded.email || user.email || ''),
    name: String(user.name || user.nik || decoded.email || decoded.uid),
    nik: String(user.nik || ''),
    role,
    isAdmin,
    menuIds: isAdmin ? ['*'] : Array.isArray(roleAccess.menuIds) ? roleAccess.menuIds.map(String) : ['dashboard'],
    databasePermissions: isAdmin
      ? {}
      : roleAccess.databasePermissions && typeof roleAccess.databasePermissions === 'object'
        ? roleAccess.databasePermissions
        : {},
  };
};

export const requireAdmin = async (req: any) => {
  const user = await authorizeAppRequest(req);
  if (!user.isAdmin) throw httpError('Akses Administrator diperlukan', 403);
  return user;
};

