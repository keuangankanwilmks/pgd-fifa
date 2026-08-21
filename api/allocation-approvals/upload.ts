import { createReadStream, promises as fs } from 'node:fs';
import formidable, { type Fields, type Files, type File } from 'formidable';
import { authorizeAllocationRequest } from '../_lib/allocation-auth.js';
import { sendApiError } from '../_lib/api-response.js';
import { getGoogleDrive, getGoogleSheets, getServerFirestore } from '../_lib/google-server.js';

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const SHEET_NAME = 'DataAlokasi';
const ALLOWED_STATUSES = new Set(['APPROVED', 'PARTIAL', 'REJECTED']);

interface ApprovalInput {
  allocationId: string;
  status: 'APPROVED' | 'PARTIAL' | 'REJECTED';
  approvedAmount: number;
}

const firstValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const firstFile = (value: File | File[] | undefined) => Array.isArray(value) ? value[0] : value;

const parseForm = (req: any) => new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
  const form = formidable({
    maxFiles: 1,
    maxFileSize: MAX_FILE_SIZE,
    allowEmptyFiles: false,
    filter: part => part.name !== 'file' || part.mimetype === 'application/pdf',
  });
  form.parse(req, (error, fields, files) => error ? reject(error) : resolve({ fields, files }));
});

const assertPdf = async (file: File) => {
  if (file.mimetype !== 'application/pdf' || !/\.pdf$/i.test(file.originalFilename || '')) {
    throw Object.assign(new Error('Dokumen wajib berupa PDF'), { statusCode: 400 });
  }
  if (!file.size || file.size > MAX_FILE_SIZE) {
    throw Object.assign(new Error('Ukuran PDF maksimal 4 MB'), { statusCode: 400 });
  }
  const handle = await fs.open(file.filepath, 'r');
  try {
    const signature = Buffer.alloc(5);
    await handle.read(signature, 0, 5, 0);
    if (signature.toString('ascii') !== '%PDF-') {
      throw Object.assign(new Error('Isi file bukan dokumen PDF yang valid'), { statusCode: 400 });
    }
  } finally {
    await handle.close();
  }
};

const deriveBatchStatus = (approvals: ApprovalInput[]) => {
  const statuses = new Set(approvals.map(item => item.status));
  if (statuses.size > 1) return 'MIXED';
  return approvals[0]?.status || 'PENDING';
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  let temporaryPath = '';
  let uploadedDriveFileId = '';
  try {
    const user = await authorizeAllocationRequest(req);
    if (!user.canEdit) throw Object.assign(new Error('Anda tidak memiliki akses Edit Anggaran'), { statusCode: 403 });

    const { fields, files } = await parseForm(req);
    const file = firstFile(files.file);
    if (!file) throw Object.assign(new Error('Pilih PDF persetujuan terlebih dahulu'), { statusCode: 400 });
    temporaryPath = file.filepath;
    await assertPdf(file);

    const batchId = String(firstValue(fields.batchId) || '').trim();
    if (!/^BAT-[A-Z0-9-]+$/.test(batchId)) {
      throw Object.assign(new Error('Batch ID tidak valid'), { statusCode: 400 });
    }

    let approvals: ApprovalInput[];
    try {
      approvals = JSON.parse(String(firstValue(fields.approvals) || '[]'));
    } catch {
      throw Object.assign(new Error('Data persetujuan tidak valid'), { statusCode: 400 });
    }
    if (!Array.isArray(approvals) || !approvals.length) {
      throw Object.assign(new Error('Rincian persetujuan wajib diisi'), { statusCode: 400 });
    }

    const spreadsheetId = process.env.REKON_SPREADSHEET_ID || process.env.VITE_REKON_SPREADSHEET_ID;
    const folderId = process.env.GOOGLE_DRIVE_APPROVAL_FOLDER_ID;
    if (!spreadsheetId) throw new Error('REKON_SPREADSHEET_ID belum dikonfigurasi di server');
    if (!folderId) throw new Error('GOOGLE_DRIVE_APPROVAL_FOLDER_ID belum dikonfigurasi di server');

    const sheets = getGoogleSheets();
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:L`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const sheetRows = sheetResponse.data.values || [];
    const batchRows = sheetRows
      .map((row, index) => ({ row, sheetRow: index + 2 }))
      .filter(item => String(item.row[10] || '').trim() === batchId);
    if (!batchRows.length) throw Object.assign(new Error('Batch Data Alokasi tidak ditemukan'), { statusCode: 404 });

    const approvalMap = new Map(approvals.map(item => [String(item.allocationId || '').trim(), item]));
    if (approvalMap.size !== batchRows.length) {
      throw Object.assign(new Error('Seluruh transaksi dalam batch wajib diberi status persetujuan'), { statusCode: 400 });
    }

    batchRows.forEach(({ row }) => {
      const allocationId = String(row[9] || '').trim();
      const requestedAmount = Number(row[6] || 0);
      const approval = approvalMap.get(allocationId);
      if (!allocationId || !approval || !ALLOWED_STATUSES.has(approval.status)) {
        throw Object.assign(new Error('Allocation ID atau status persetujuan tidak valid'), { statusCode: 400 });
      }
      const approvedAmount = Number(approval.approvedAmount);
      if (!Number.isFinite(approvedAmount) || approvedAmount < 0 || approvedAmount > requestedAmount) {
        throw Object.assign(new Error(`Nominal persetujuan ${allocationId} tidak valid`), { statusCode: 400 });
      }
      if (approval.status === 'APPROVED' && approvedAmount !== requestedAmount) {
        throw Object.assign(new Error(`Status Disetujui pada ${allocationId} harus sama dengan nominal pengajuan`), { statusCode: 400 });
      }
      if (approval.status === 'PARTIAL' && !(approvedAmount > 0 && approvedAmount < requestedAmount)) {
        throw Object.assign(new Error(`Status Disetujui Sebagian pada ${allocationId} harus lebih kecil dari pengajuan`), { statusCode: 400 });
      }
      if (approval.status === 'REJECTED' && approvedAmount !== 0) {
        throw Object.assign(new Error(`Status Ditolak pada ${allocationId} harus bernilai nol`), { statusCode: 400 });
      }
    });

    const db = getServerFirestore();
    const metadataRef = db.collection('allocation_approval_batches').doc(batchId);
    const previousMetadata = await metadataRef.get();
    const previousDriveFileId = String(previousMetadata.data()?.driveFileId || '');
    const drive = getGoogleDrive();
    const uploadDate = new Date().toISOString();
    const driveFileName = `Approval_Dropping_${batchId}_${uploadDate.slice(0, 10)}.pdf`;
    const uploadResponse = await drive.files.create({
      supportsAllDrives: true,
      fields: 'id,name,size,mimeType',
      requestBody: { name: driveFileName, parents: [folderId] },
      media: { mimeType: 'application/pdf', body: createReadStream(file.filepath) },
    });
    uploadedDriveFileId = String(uploadResponse.data.id || '');
    if (!uploadedDriveFileId) throw new Error('Google Drive tidak mengembalikan File ID');

    const updateData: { range: string; values: unknown[][] }[] = [];
    const rollbackData: { range: string; values: unknown[][] }[] = [];
    batchRows.forEach(({ row, sheetRow }) => {
      const approval = approvalMap.get(String(row[9] || '').trim())!;
      updateData.push(
        { range: `${SHEET_NAME}!H${sheetRow}:I${sheetRow}`, values: [[approval.approvedAmount, approval.status]] },
        { range: `${SHEET_NAME}!L${sheetRow}`, values: [[uploadDate]] },
      );
      rollbackData.push(
        { range: `${SHEET_NAME}!H${sheetRow}:I${sheetRow}`, values: [[row[7] || '', row[8] || 'PENDING']] },
        { range: `${SHEET_NAME}!L${sheetRow}`, values: [[row[11] || '']] },
      );
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updateData },
    });

    try {
      const totalRequested = batchRows.reduce((sum, item) => sum + Number(item.row[6] || 0), 0);
      const totalApproved = approvals.reduce((sum, item) => sum + Number(item.approvedAmount || 0), 0);
      await metadataRef.set({
        batchId,
        allocationIds: batchRows.map(item => String(item.row[9] || '')),
        status: deriveBatchStatus(approvals),
        totalRequested,
        totalApproved,
        transactionCount: batchRows.length,
        approvals,
        driveFileId: uploadedDriveFileId,
        fileName: driveFileName,
        fileSize: file.size,
        mimeType: 'application/pdf',
        uploadedBy: { uid: user.uid, name: user.name, role: user.role },
        uploadedAt: uploadDate,
        updatedAt: uploadDate,
      }, { merge: false });
    } catch (error) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: rollbackData },
      });
      throw error;
    }

    if (previousDriveFileId && previousDriveFileId !== uploadedDriveFileId) {
      await drive.files.delete({ fileId: previousDriveFileId, supportsAllDrives: true }).catch(error => {
        console.error('Gagal menghapus file approval lama:', error);
      });
    }

    return res.status(200).json({
      success: true,
      metadata: {
        batchId,
        status: deriveBatchStatus(approvals),
        fileName: driveFileName,
        fileSize: file.size,
        uploadedAt: uploadDate,
        uploadedBy: user.name,
      },
    });
  } catch (error) {
    if (uploadedDriveFileId) {
      await getGoogleDrive().files.delete({ fileId: uploadedDriveFileId, supportsAllDrives: true }).catch(() => undefined);
    }
    return sendApiError(res, error);
  } finally {
    if (temporaryPath) await fs.unlink(temporaryPath).catch(() => undefined);
  }
}
