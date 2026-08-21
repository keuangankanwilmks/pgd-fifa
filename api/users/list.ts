import { requireAdmin } from '../_lib/app-auth.js';
import { sendApiError } from '../_lib/api-response.js';
import { getServerFirestore } from '../_lib/google-server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });

  try {
    await requireAdmin(req);
    const snapshot = await getServerFirestore().collection('users').get();
    const users = snapshot.docs.map(item => {
      const data = item.data() || {};
      return {
        uid: String(data.uid || item.id),
        nik: String(data.nik || ''),
        name: String(data.name || ''),
        role: String(data.role || ''),
        status: data.status === 'inactive' ? 'inactive' : 'active',
        email: String(data.email || ''),
      };
    });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, users });
  } catch (error) {
    return sendApiError(res, error, 'Gagal memuat user');
  }
}
