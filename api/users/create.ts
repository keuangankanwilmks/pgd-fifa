import { requireAdmin } from '../_lib/app-auth.js';
import { sendApiError } from '../_lib/api-response.js';
import { getServerAuth, getServerFirestore } from '../_lib/google-server.js';

const validateRole = async (role: string) => {
  if (role === 'admin' || role === 'user') return;
  if (!(await getServerFirestore().collection('role_access').doc(role).get()).exists) {
    throw Object.assign(new Error('Role user tidak valid'), { statusCode: 400 });
  }
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });
  let createdUid = '';
  try {
    await requireAdmin(req);
    const nik = String(req.body?.nik || '').trim();
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || 'user').trim().toLowerCase();
    const status = String(req.body?.status || 'active');
    const password = String(req.body?.password || '');
    const email = String(req.body?.email || `${nik}@fifa.local`).trim().toLowerCase();
    if (!nik || !name || !email || password.length < 6 || !['active', 'inactive'].includes(status)) {
      throw Object.assign(new Error('Data user belum lengkap atau tidak valid'), { statusCode: 400 });
    }
    await validateRole(role);

    const db = getServerFirestore();
    if (!(await db.collection('users').where('nik', '==', nik).limit(1).get()).empty) {
      throw Object.assign(new Error('NIK sudah terdaftar'), { statusCode: 409 });
    }

    const authUser = await getServerAuth().createUser({ email, password, displayName: name, disabled: status !== 'active' });
    createdUid = authUser.uid;
    const user = { uid: authUser.uid, nik, name, role, status, email };
    await db.collection('users').doc(authUser.uid).set(user);
    return res.status(201).json({ success: true, user });
  } catch (error) {
    if (createdUid) await getServerAuth().deleteUser(createdUid).catch(() => undefined);
    return sendApiError(res, error, 'Gagal membuat user');
  }
}
