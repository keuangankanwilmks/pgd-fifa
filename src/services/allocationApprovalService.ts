import { auth } from '../firebase';

export type ApprovalStatus = 'APPROVED' | 'PARTIAL' | 'REJECTED';

export interface ApprovalInput {
  allocationId: string;
  status: ApprovalStatus;
  approvedAmount: number;
}

export interface ApprovalBatchMetadata {
  batchId: string;
  allocationIds: string[];
  status: 'APPROVED' | 'PARTIAL' | 'REJECTED' | 'MIXED';
  totalRequested: number;
  totalApproved: number;
  transactionCount: number;
  approvals: ApprovalInput[];
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: { uid: string; name: string; role: string };
  uploadedAt: string;
  updatedAt: string;
}

const getIdToken = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login diperlukan');
  return user.getIdToken();
};

const parseError = async (response: Response) => {
  const data = await response.json().catch(() => null);
  throw new Error(data?.error || `Permintaan approval gagal (${response.status})`);
};

export const allocationApprovalService = {
  async getMetadata(): Promise<ApprovalBatchMetadata[]> {
    const response = await fetch('/api/allocation-approvals/list', {
      headers: { Authorization: `Bearer ${await getIdToken()}` },
    });
    if (!response.ok) return parseError(response);
    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  },

  async upload(batchId: string, approvals: ApprovalInput[], file: File) {
    const formData = new FormData();
    formData.append('batchId', batchId);
    formData.append('approvals', JSON.stringify(approvals));
    formData.append('file', file, file.name);
    const response = await fetch('/api/allocation-approvals/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getIdToken()}` },
      body: formData,
    });
    if (!response.ok) return parseError(response);
    return response.json();
  },

  async getFile(batchId: string, download = false) {
    const query = new URLSearchParams({ batchId, ...(download ? { download: '1' } : {}) });
    const response = await fetch(`/api/allocation-approvals/file?${query}`, {
      headers: { Authorization: `Bearer ${await getIdToken()}` },
    });
    if (!response.ok) return parseError(response);
    return response.blob();
  },
};
