import { authorizeAllocationRequest } from '../_lib/allocation-auth';
import { sendApiError } from '../_lib/api-response';
import { getServerFirestore } from '../_lib/google-server';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });
  }

  try {
    const user = await authorizeAllocationRequest(req);
    if (!user.canView) {
      return res.status(403).json({ success: false, error: 'Anda tidak memiliki akses Data Alokasi' });
    }

    const snapshot = await getServerFirestore().collection('allocation_approval_batches').get();
    const items = snapshot.docs
      .map(item => ({ batchId: item.id, ...item.data() }))
      .sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, items });
  } catch (error) {
    return sendApiError(res, error, 'Gagal memuat metadata dokumen persetujuan');
  }
}
