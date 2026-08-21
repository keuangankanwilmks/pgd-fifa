import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '../_lib/app-auth';
import { sendApiError } from '../_lib/api-response';
import { getServerFirestore } from '../_lib/google-server';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });
  try {
    await requireAdmin(req);
    const db = getServerFirestore();
    const snapshot = await db.collection('users').get();
    const affected = snapshot.docs.filter(item => Object.prototype.hasOwnProperty.call(item.data(), 'password'));
    for (let offset = 0; offset < affected.length; offset += 400) {
      const batch = db.batch();
      affected.slice(offset, offset + 400).forEach(item => batch.update(item.ref, { password: FieldValue.delete() }));
      await batch.commit();
    }
    return res.status(200).json({ success: true, removed: affected.length });
  } catch (error) {
    return sendApiError(res, error, 'Gagal membersihkan password lama');
  }
}
