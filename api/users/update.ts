import { requireAdmin } from '../_lib/app-auth.js';
import { sendApiError } from '../_lib/api-response.js';
import { getServerAuth, getServerFirestore } from '../_lib/google-server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });
  try {
    const admin = await requireAdmin(req);
    const uid = String(req.body?.uid || '').trim();
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || '').trim().toLowerCase();
    const status = String(req.body?.status || '');
    const password = String(req.body?.password || '');
    if (!uid || !name || !role || !['active', 'inactive'].includes(status) || (password && password.length < 6)) {
      throw Object.assign(new Error('Data user tidak valid'), { statusCode: 400 });
    }
    if (uid === admin.uid && (role !== 'admin' || status !== 'active')) {
      throw Object.assign(new Error('Administrator tidak dapat menonaktifkan atau menurunkan role akunnya sendiri'), { statusCode: 400 });
    }
    if (!['admin', 'user'].includes(role) && !(await getServerFirestore().collection('role_access').doc(role).get()).exists) {
      throw Object.assign(new Error('Role user tidak valid'), { statusCode: 400 });
    }

    await getServerAuth().updateUser(uid, {
      displayName: name,
      disabled: status !== 'active',
      ...(password ? { password } : {}),
    });
    await getServerFirestore().collection('users').doc(uid).update({ name, role, status, uid });
    return res.status(200).json({ success: true });
  } catch (error) {
    return sendApiError(res, error, 'Gagal memperbarui user');
  }
}
