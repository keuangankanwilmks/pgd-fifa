import { requireAdmin } from '../_lib/app-auth.js';
import { sendApiError } from '../_lib/api-response.js';
import { getServerAuth, getServerFirestore } from '../_lib/google-server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });
  try {
    const admin = await requireAdmin(req);
    const uid = String(req.body?.uid || '').trim();
    if (!uid) throw Object.assign(new Error('UID user wajib diisi'), { statusCode: 400 });
    if (uid === admin.uid) throw Object.assign(new Error('User yang sedang login tidak dapat menghapus akunnya sendiri'), { statusCode: 400 });

    const ref = getServerFirestore().collection('users').doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw Object.assign(new Error('User tidak ditemukan'), { statusCode: 404 });
    if (snapshot.data()?.role === 'admin' && snapshot.data()?.email === 'keuangan.kanwilmks@gmail.com') {
      throw Object.assign(new Error('Akun Super Administrator tidak dapat dihapus'), { statusCode: 403 });
    }

    await getServerAuth().deleteUser(uid);
    await ref.delete();
    return res.status(200).json({ success: true });
  } catch (error) {
    return sendApiError(res, error, 'Gagal menghapus user');
  }
}
