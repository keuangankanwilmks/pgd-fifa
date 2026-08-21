import { authorizeAppRequest } from '../_lib/app-auth.js';
import { sendApiError } from '../_lib/api-response.js';
import { getServerFirestore } from '../_lib/google-server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });
  try {
    const user = await authorizeAppRequest(req);
    const nik = String(req.body?.nik || '').trim();
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!nik || !name || !email) throw Object.assign(new Error('Profil user tidak valid'), { statusCode: 400 });

    const db = getServerFirestore();
    const duplicate = await db.collection('users').where('nik', '==', nik).limit(2).get();
    if (duplicate.docs.some(item => item.id !== user.uid)) {
      throw Object.assign(new Error('NIK sudah digunakan oleh user lain'), { statusCode: 409 });
    }
    await db.collection('users').doc(user.uid).update({ nik, name, email, uid: user.uid });
    return res.status(200).json({ success: true });
  } catch (error) {
    return sendApiError(res, error, 'Gagal memperbarui profil');
  }
}
