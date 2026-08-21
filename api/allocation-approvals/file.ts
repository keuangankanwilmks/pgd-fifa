import { authorizeAllocationRequest } from '../_lib/allocation-auth';
import { sendApiError } from '../_lib/api-response';
import { getGoogleDrive, getServerFirestore } from '../_lib/google-server';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const user = await authorizeAllocationRequest(req);
    if (!user.canView) throw Object.assign(new Error('Anda tidak memiliki akses Data Alokasi'), { statusCode: 403 });

    const url = new URL(req.url || '', 'http://localhost');
    const batchId = String(url.searchParams.get('batchId') || '').trim();
    const shouldDownload = url.searchParams.get('download') === '1';
    if (!batchId) throw Object.assign(new Error('Batch ID wajib diisi'), { statusCode: 400 });

    const snapshot = await getServerFirestore().collection('allocation_approval_batches').doc(batchId).get();
    if (!snapshot.exists) throw Object.assign(new Error('Dokumen persetujuan belum tersedia'), { statusCode: 404 });
    const metadata = snapshot.data() || {};
    const driveFileId = String(metadata.driveFileId || '');
    if (!driveFileId) throw Object.assign(new Error('Drive File ID tidak ditemukan'), { statusCode: 404 });

    const drive = getGoogleDrive();
    const driveMetadata = await drive.files.get({
      fileId: driveFileId,
      supportsAllDrives: true,
      fields: 'name,size,mimeType',
    });
    if (Number(driveMetadata.data.size || 0) > 4 * 1024 * 1024) {
      throw Object.assign(new Error('Ukuran dokumen melebihi batas preview FIFA'), { statusCode: 413 });
    }

    const fileName = String(driveMetadata.data.name || metadata.fileName || `${batchId}.pdf`).replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (driveMetadata.data.size) res.setHeader('Content-Length', String(driveMetadata.data.size));

    const response = await drive.files.get(
      { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    response.data.on('error', (error: Error) => {
      console.error('Drive stream error:', error);
      if (!res.headersSent) sendApiError(res, error);
      else res.end();
    });
    response.data.pipe(res);
  } catch (error) {
    return sendApiError(res, error);
  }
}

