import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileCheck2, FileUp, RefreshCw, Search, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import { AnimatedModal } from './AnimatedModal';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { canModifyDatabase, type RoleDatabasePermissionMap } from '../constants/databasePermissions';
import { googleSheetsService } from '../services/googleSheetsService';
import {
  allocationApprovalService,
  type ApprovalBatchMetadata,
  type ApprovalInput,
  type ApprovalStatus,
} from '../services/allocationApprovalService';

interface AllocationApprovalPanelProps {
  currentUser?: any;
  roleDatabasePermissionMap?: RoleDatabasePermissionMap;
}

interface AllocationItem {
  tanggal: string;
  kodeOutlet: string;
  namaOutlet: string;
  kebutuhanAnggaran: string;
  mataAnggaran: string;
  kodeActivity: string;
  requestedAmount: number;
  approvedAmount: number;
  status: string;
  allocationId: string;
  batchId: string;
}

interface AllocationBatch {
  batchId: string;
  tanggal: string;
  rows: AllocationItem[];
  totalRequested: number;
  totalApproved: number;
  metadata?: ApprovalBatchMetadata;
}

interface EditableApproval {
  allocationId: string;
  approvedAmount: number;
  item: AllocationItem;
  status: ApprovalStatus | '';
}

const SHEET_NAME = 'DataAlokasi';
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const statusOptions = [
  { value: 'APPROVED', label: 'DISETUJUI' },
  { value: 'PARTIAL', label: 'DISETUJUI SEBAGIAN' },
  { value: 'REJECTED', label: 'DITOLAK' },
] as const;

const selectStyles = {
  control: (base: any) => ({ ...base, minHeight: 34, height: 34, borderRadius: 6, borderColor: '#e5e7eb', boxShadow: 'none', fontSize: 11 }),
  valueContainer: (base: any) => ({ ...base, height: 32, padding: '0 8px' }),
  indicatorsContainer: (base: any) => ({ ...base, height: 32 }),
  menuPortal: (base: any) => ({ ...base, zIndex: 180 }),
  option: (base: any, state: any) => ({ ...base, fontSize: 11, backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#ecfdf5' : '#fff', color: state.isSelected ? '#fff' : '#374151' }),
};

const parseAmount = (value: unknown) => {
  if (typeof value === 'number') return value;
  return Number(String(value ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
};
const formatNumber = (value: number) => new Intl.NumberFormat('id-ID').format(value || 0);
const formatSheetDate = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return '-';

  const serial = typeof value === 'number' ? value : /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
  let date: Date | null = null;
  if (Number.isFinite(serial) && serial > 0) {
    date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  } else {
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dmy = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
    if (iso) date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    else if (dmy) date = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  }

  if (!date || Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};
const formatDateTime = (value?: string) => value
  ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '-';
const statusLabel = (value: string) => ({
  APPROVED: 'DISETUJUI', PARTIAL: 'DISETUJUI SEBAGIAN', REJECTED: 'DITOLAK', MIXED: 'CAMPURAN', PENDING_DOCUMENT: 'MENUNGGU DOKUMEN',
}[value] || value);
const statusClass = (value: string) => value === 'APPROVED'
  ? 'bg-emerald-100 text-emerald-700'
  : value === 'PARTIAL' || value === 'MIXED'
    ? 'bg-amber-100 text-amber-700'
    : value === 'REJECTED'
      ? 'bg-red-100 text-red-700'
      : 'bg-gray-100 text-gray-500';

export function AllocationApprovalPanel({ currentUser, roleDatabasePermissionMap = {} }: AllocationApprovalPanelProps) {
  const [rows, setRows] = useState<AllocationItem[]>([]);
  const [metadata, setMetadata] = useState<ApprovalBatchMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<any>(null);
  const [selectedBatch, setSelectedBatch] = useState<AllocationBatch | null>(null);
  const [approvals, setApprovals] = useState<EditableApproval[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBatch, setPreviewBatch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
  const canEdit = canModifyDatabase(currentUser?.role, 'anggaran', 'edit', roleDatabasePermissionMap);

  const loadData = async () => {
    if (!spreadsheetId) return toast.error('Spreadsheet ID belum dikonfigurasi');
    setIsLoading(true);
    try {
      const [sheetRows, metadataRows] = await Promise.all([
        googleSheetsService.readData(spreadsheetId, `${SHEET_NAME}!A2:L`, 'UNFORMATTED_VALUE'),
        allocationApprovalService.getMetadata(),
      ]);
      setRows((sheetRows || []).filter((row: unknown[]) => String(row[10] || '').trim()).map((row: unknown[]) => ({
        tanggal: formatSheetDate(row[0]),
        kodeOutlet: String(row[1] || ''),
        namaOutlet: String(row[2] || ''),
        kebutuhanAnggaran: String(row[3] || ''),
        mataAnggaran: String(row[4] || ''),
        kodeActivity: String(row[5] || ''),
        requestedAmount: parseAmount(row[6]),
        approvedAmount: parseAmount(row[7]),
        status: String(row[8] || 'PENDING'),
        allocationId: String(row[9] || ''),
        batchId: String(row[10] || ''),
      })));
      setMetadata(metadataRows);
    } catch (error: any) {
      toast.error(`Gagal memuat Dokumen Persetujuan: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);
  useEscapeToClose(Boolean(selectedBatch) && !isUploading, () => setSelectedBatch(null));
  useEscapeToClose(Boolean(previewUrl), () => {
    URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
  });

  const metadataByBatch = useMemo(() => new Map(metadata.map(item => [item.batchId, item])), [metadata]);
  const batches = useMemo(() => Array.from(rows.reduce((map, item) => {
    const current = map.get(item.batchId) || [];
    current.push(item);
    map.set(item.batchId, current);
    return map;
  }, new Map<string, AllocationItem[]>()).entries()).map(([batchId, batchRows]) => {
    const batchMetadata = metadataByBatch.get(batchId);
    return {
      batchId,
      tanggal: batchRows[0]?.tanggal || '',
      rows: batchRows,
      totalRequested: batchRows.reduce((sum, item) => sum + item.requestedAmount, 0),
      totalApproved: batchRows.reduce((sum, item) => sum + item.approvedAmount, 0),
      metadata: batchMetadata,
    };
  }).sort((a, b) => b.batchId.localeCompare(a.batchId)), [rows, metadataByBatch]);
  const filteredBatches = useMemo(() => batches.filter(batch => {
    const batchStatus = batch.metadata?.status || 'PENDING_DOCUMENT';
    const keyword = search.trim().toLowerCase();
    const matchesSearch = !keyword || [batch.batchId, batch.tanggal, ...batch.rows.flatMap(item => [item.kodeOutlet, item.namaOutlet])]
      .some(value => String(value).toLowerCase().includes(keyword));
    return matchesSearch && (!statusFilter || batchStatus === statusFilter.value);
  }), [batches, search, statusFilter]);

  const openApproval = (batch: AllocationBatch) => {
    const existing = new Map((batch.metadata?.approvals || []).map(item => [item.allocationId, item]));
    setApprovals(batch.rows.map(item => {
      const previous = existing.get(item.allocationId);
      return {
        item,
        allocationId: item.allocationId,
        status: previous?.status || '',
        approvedAmount: previous?.approvedAmount ?? 0,
      };
    }));
    setPdfFile(null);
    setSelectedBatch(batch);
  };

  const updateApprovalStatus = (allocationId: string, status: ApprovalStatus | '') => {
    setApprovals(current => current.map(item => item.allocationId !== allocationId ? item : {
      ...item,
      status,
      approvedAmount: status === 'APPROVED' ? item.item.requestedAmount : status === 'REJECTED' ? 0 : 0,
    }));
  };

  const validateApprovals = () => approvals.every(item => {
    if (item.status === 'APPROVED') return item.approvedAmount === item.item.requestedAmount;
    if (item.status === 'PARTIAL') return item.approvedAmount > 0 && item.approvedAmount < item.item.requestedAmount;
    if (item.status === 'REJECTED') return item.approvedAmount === 0;
    return false;
  });

  const chooseFile = (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name)) return toast.error('Dokumen wajib berupa PDF');
    if (file.size > MAX_FILE_SIZE) return toast.error('Ukuran PDF maksimal 4 MB');
    if (!file.size) return toast.error('File PDF kosong');
    setPdfFile(file);
  };

  const uploadApproval = async () => {
    if (!selectedBatch || !pdfFile) return toast.error('Pilih PDF persetujuan terlebih dahulu');
    if (!validateApprovals()) return toast.error('Lengkapi status dan nominal persetujuan seluruh transaksi');
    setIsUploading(true);
    const toastId = toast.loading(`Mengunggah persetujuan ${selectedBatch.batchId}...`);
    try {
      await allocationApprovalService.upload(selectedBatch.batchId, approvals.map(({ item: _item, ...approval }) => approval as ApprovalInput), pdfFile);
      toast.success('Dokumen dan data persetujuan berhasil disimpan', { id: toastId });
      setSelectedBatch(null);
      await loadData();
    } catch (error: any) {
      toast.error(`Gagal menyimpan persetujuan: ${error.message}`, { id: toastId });
    } finally {
      setIsUploading(false);
    }
  };

  const previewFile = async (batch: AllocationBatch) => {
    const toastId = toast.loading('Membuka PDF...');
    try {
      const blob = await allocationApprovalService.getFile(batch.batchId);
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewBatch(batch.batchId);
      toast.dismiss(toastId);
    } catch (error: any) {
      toast.error(`Gagal membuka PDF: ${error.message}`, { id: toastId });
    }
  };

  const downloadFile = async (batch: AllocationBatch) => {
    const toastId = toast.loading('Mengunduh PDF...');
    try {
      const blob = await allocationApprovalService.getFile(batch.batchId, true);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = batch.metadata?.fileName || `Approval_Dropping_${batch.batchId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('PDF berhasil diunduh', { id: toastId });
    } catch (error: any) {
      toast.error(`Gagal mengunduh PDF: ${error.message}`, { id: toastId });
    }
  };

  const totalApproved = approvals.reduce((sum, item) => sum + (Number(item.approvedAmount) || 0), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-[#009B4F]"><FileCheck2 className="h-5 w-5" /></div>
            <div><h2 className="text-lg font-black text-gray-800">Dokumen Persetujuan</h2><p className="text-xs text-gray-500">Satu dokumen PDF untuk setiap batch Input Dropping.</p></div>
          </div>
          <button type="button" onClick={loadData} disabled={isLoading} className="rounded-lg bg-gray-50 p-2 text-gray-500 hover:bg-gray-100" title="Refresh Data"><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_260px]">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari Batch ID atau outlet..." className="h-9 w-full rounded-lg border border-gray-200 pl-10 pr-3 text-xs outline-none focus:border-[#009B4F]" /></div>
          <Select options={[{ value: 'PENDING_DOCUMENT', label: 'MENUNGGU DOKUMEN' }, ...statusOptions, { value: 'MIXED', label: 'CAMPURAN' }]} value={statusFilter} onChange={setStatusFilter} placeholder="Filter Status..." isClearable styles={selectStyles} />
        </div>
      </div>

      <div className="min-h-[420px] flex-1 overflow-auto">
        <table className="w-full min-w-[1250px] border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-[#005245] text-white"><tr>{['Batch ID', 'Tanggal', 'Jumlah Trx', 'Total Pengajuan', 'Total Persetujuan', 'Status', 'Dokumen', 'Diupload Oleh', 'Waktu Upload', 'Aksi'].map(label => <th key={label} className={`border-r border-[#004237] px-3 py-2 text-[9px] font-black uppercase ${['Jumlah Trx', 'Status', 'Aksi'].includes(label) ? 'text-center' : label.startsWith('Total') ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? <tr><td colSpan={10} className="py-20 text-center text-gray-400">Memuat data...</td></tr> : filteredBatches.length ? filteredBatches.map((batch, index) => {
              const batchStatus = batch.metadata?.status || 'PENDING_DOCUMENT';
              return <tr key={batch.batchId} className={index % 2 ? 'bg-gray-50/60' : 'bg-white'}>
                <td className="px-3 py-2 font-mono font-bold text-gray-700">{batch.batchId}</td><td className="px-3 py-2">{batch.tanggal}</td><td className="px-3 py-2 text-center font-bold">{batch.rows.length}</td><td className="px-3 py-2 text-right font-mono font-bold text-blue-600">Rp {formatNumber(batch.totalRequested)}</td><td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">Rp {formatNumber(batch.totalApproved)}</td><td className="px-3 py-2 text-center"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${statusClass(batchStatus)}`}>{statusLabel(batchStatus)}</span></td><td className="max-w-[180px] truncate px-3 py-2" title={batch.metadata?.fileName}>{batch.metadata?.fileName || '-'}</td><td className="px-3 py-2">{batch.metadata?.uploadedBy?.name || '-'}</td><td className="px-3 py-2">{formatDateTime(batch.metadata?.uploadedAt)}</td>
                <td className="px-3 py-2"><div className="flex justify-center gap-1">{canEdit && <button type="button" onClick={() => openApproval(batch)} className="rounded-md bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100" title={batch.metadata ? 'Ganti Dokumen' : 'Upload Persetujuan'}>{batch.metadata ? <FileUp className="h-4 w-4" /> : <Upload className="h-4 w-4" />}</button>}{batch.metadata && <><button type="button" onClick={() => previewFile(batch)} className="rounded-md bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100" title="Lihat PDF"><Eye className="h-4 w-4" /></button><button type="button" onClick={() => downloadFile(batch)} className="rounded-md bg-gray-50 p-1.5 text-gray-600 hover:bg-gray-100" title="Unduh PDF"><Download className="h-4 w-4" /></button></>}</div></td>
              </tr>;
            }) : <tr><td colSpan={10} className="py-20 text-center italic text-gray-400">Belum ada batch Input Dropping ditemukan.</td></tr>}
          </tbody>
        </table>
      </div>

      <AnimatedModal isOpen={Boolean(selectedBatch)} className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
        {selectedBatch && <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4"><div><h3 className="text-lg font-black text-gray-800">{selectedBatch.metadata ? 'Ganti' : 'Upload'} Persetujuan {selectedBatch.batchId}</h3><p className="mt-1 text-xs text-gray-500">Tentukan hasil persetujuan setiap transaksi dan unggah PDF final.</p></div><button type="button" onClick={() => setSelectedBatch(null)} disabled={isUploading} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
          <div className="grid grid-cols-1 gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3 md:grid-cols-3"><div><span className="text-[9px] font-black uppercase text-gray-400">Jumlah Transaksi</span><p className="font-bold">{selectedBatch.rows.length} baris</p></div><div><span className="text-[9px] font-black uppercase text-gray-400">Total Pengajuan</span><p className="font-bold text-blue-600">Rp {formatNumber(selectedBatch.totalRequested)}</p></div><div><span className="text-[9px] font-black uppercase text-gray-400">Total Persetujuan</span><p className="font-bold text-emerald-700">Rp {formatNumber(totalApproved)}</p></div></div>
          <div className="min-h-0 flex-1 overflow-auto p-5"><table className="w-full min-w-[1050px] border-collapse text-[11px]"><thead className="bg-[#005245] text-white"><tr>{['Outlet', 'Kebutuhan Anggaran', 'Mata Anggaran', 'Kode Activity', 'Nominal Pengajuan', 'Status', 'Nominal Persetujuan'].map(label => <th key={label} className={`border-r border-[#004237] px-3 py-2 text-[9px] font-black uppercase ${label.startsWith('Nominal') ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{approvals.map(approval => <tr key={approval.allocationId}><td className="px-3 py-2 font-bold">{approval.item.kodeOutlet} - {approval.item.namaOutlet}</td><td className="px-3 py-2">{approval.item.kebutuhanAnggaran}</td><td className="px-3 py-2">{approval.item.mataAnggaran}</td><td className="px-3 py-2">{approval.item.kodeActivity}</td><td className="px-3 py-2 text-right font-mono font-bold text-blue-600">Rp {formatNumber(approval.item.requestedAmount)}</td><td className="min-w-[190px] px-2 py-1"><Select options={statusOptions as any} value={statusOptions.find(option => option.value === approval.status) || null} onChange={(option: any) => updateApprovalStatus(approval.allocationId, option?.value || '')} placeholder="Pilih Status..." styles={selectStyles} menuPortalTarget={document.body} menuPosition="fixed" /></td><td className="px-2 py-1"><input type="number" min="0" max={approval.item.requestedAmount} disabled={approval.status === 'APPROVED' || approval.status === 'REJECTED'} value={approval.approvedAmount || ''} onChange={event => setApprovals(current => current.map(item => item.allocationId === approval.allocationId ? { ...item, approvedAmount: Number(event.target.value) || 0 } : item))} className="h-9 w-full min-w-[150px] rounded-md border border-gray-200 px-2 text-right font-mono outline-none focus:border-[#009B4F] disabled:bg-gray-50" /></td></tr>)}</tbody></table></div>
          <div className="border-t border-gray-100 px-5 py-4"><input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} /><button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }} className="flex w-full items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm font-bold text-gray-600 hover:border-[#009B4F] hover:bg-emerald-50"><FileUp className="h-5 w-5 text-[#009B4F]" />{pdfFile ? `${pdfFile.name} (${(pdfFile.size / 1024 / 1024).toFixed(2)} MB)` : 'Pilih atau drop PDF persetujuan maksimal 4 MB'}</button><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setSelectedBatch(null)} disabled={isUploading} className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold">Batal</button><button type="button" onClick={uploadApproval} disabled={isUploading || !pdfFile || !validateApprovals()} className="flex items-center gap-2 rounded-lg bg-[#009B4F] px-5 py-2 text-xs font-bold text-white disabled:bg-gray-300">{isUploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{isUploading ? 'Menyimpan...' : 'Simpan Persetujuan'}</button></div></div>
        </div>}
      </AnimatedModal>

      <AnimatedModal isOpen={Boolean(previewUrl)} className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-4">
        <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white"><div className="flex items-center justify-between border-b border-gray-100 px-5 py-3"><div><h3 className="font-black text-gray-800">Preview PDF {previewBatch}</h3><p className="text-xs text-gray-500">Dokumen privat ditampilkan melalui FIFA.</p></div><button type="button" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>{previewUrl && <iframe src={previewUrl} title={`Preview ${previewBatch}`} className="min-h-0 flex-1 border-0" />}</div>
      </AnimatedModal>
    </div>
  );
}
