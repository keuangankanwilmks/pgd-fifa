import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, ChevronLeft, ChevronRight, Download, Edit2, Eye, EyeOff, FileSpreadsheet, FileText, Mail, MessageCircle, Plus, RefreshCw, Search, Square, Trash2, WalletCards, X, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { googleSheetsService } from '../services/googleSheetsService';
import { cabangService, type Cabang } from '../services/cabangService';
import { emailBlastService, type EmailQuotaInfo, type BlastEmailMessage } from '../services/emailBlastService';
import { blastTemplateService, defaultAlokasiBlastEmailTemplate, defaultAlokasiBlastWhatsAppTemplate } from '../services/blastTemplateService';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageSizeDropdown, type PageSizeValue } from '../components/PageSizeDropdown';
import { AnimatedModal } from '../components/AnimatedModal';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { canModifyDatabase, type RoleDatabasePermissionMap } from '../constants/databasePermissions';

interface AlokasiRecord {
  rowIndex: number;
  tanggal: string;
  kodeOutlet: string;
  namaOutlet: string;
  kebutuhanAnggaran: string;
  mataAnggaran: string;
  kodeActivity: string;
  nominalPersetujuan: number;
}

interface OutletBlastGroup {
  tanggal: string;
  outlet: string;
  email: string;
  whatsapp: string;
  rows: AlokasiRecord[];
  totalNominal: number;
}

interface DataAlokasiProps {
  currentUser?: any;
  roleDatabasePermissionMap?: RoleDatabasePermissionMap;
}

const sheetName = 'DataAlokasi';
const headers = ['Tanggal', 'Kode Outlet', 'Nama Outlet', 'Kebutuhan Anggaran', 'Mata Anggaran', 'Kode Activity', 'Nominal Persetujuan'];
const pageSizeOptions: { value: PageSizeValue; label: string }[] = [{ value: 25, label: '25' }, { value: 50, label: '50' }, { value: 100, label: '100' }, { value: 'all', label: 'All' }];
const blankRecord = (): AlokasiRecord => ({ rowIndex: 0, tanggal: new Date().toISOString().slice(0, 10), kodeOutlet: '', namaOutlet: '', kebutuhanAnggaran: '', mataAnggaran: '', kodeActivity: '', nominalPersetujuan: 0 });
const normalizeText = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const parseAmount = (value: unknown) => typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
const normalizeWhatsapp = (value: unknown) => {
  let result = String(value ?? '').replace(/\D/g, '');
  if (result.startsWith('0')) result = `62${result.slice(1)}`;
  if (result.startsWith('8')) result = `62${result}`;
  return result;
};
const isValidWhatsapp = (value: string) => /^62\d{8,15}$/.test(value);
const toComparableDate = (value: string) => {
  const iso = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const match = iso.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : '';
};
const toSheetRow = (item: AlokasiRecord) => [item.tanggal, item.kodeOutlet.trim(), item.namaOutlet.trim(), item.kebutuhanAnggaran.trim(), item.mataAnggaran.trim(), item.kodeActivity.trim(), item.nominalPersetujuan];
const selectStyles = {
  control: (base: any) => ({ ...base, minHeight: '36px', height: '36px', borderRadius: '0.5rem', borderColor: '#e5e7eb', backgroundColor: 'white', boxShadow: 'none', fontSize: '0.75rem', '&:hover': { borderColor: '#009B4F' } }),
  valueContainer: (base: any) => ({ ...base, height: '34px', padding: '0 8px' }),
  indicatorsContainer: (base: any) => ({ ...base, height: '34px' }),
  placeholder: (base: any) => ({ ...base, color: '#9ca3af' }),
  singleValue: (base: any) => ({ ...base, color: '#374151' }),
  menu: (base: any) => ({ ...base, zIndex: 80, borderRadius: '0.5rem', overflow: 'hidden' }),
  menuPortal: (base: any) => ({ ...base, zIndex: 140 }),
  option: (base: any, state: any) => ({ ...base, fontSize: '0.75rem', backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white', color: state.isSelected ? 'white' : '#374151' }),
};

export function DataAlokasi({ currentUser, roleDatabasePermissionMap = {} }: DataAlokasiProps) {
  const [rawData, setRawData] = useState<AlokasiRecord[]>([]);
  const [cabangMaster, setCabangMaster] = useState<Cabang[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOutletCode, setSelectedOutletCode] = useState<any>(null);
  const [selectedMataAnggaran, setSelectedMataAnggaran] = useState<any>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeValue>(25);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<AlokasiRecord>(blankRecord);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isBulkDelete, setIsBulkDelete] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);
  const [isBlastOpen, setIsBlastOpen] = useState(false);
  const [isWhatsAppBlastOpen, setIsWhatsAppBlastOpen] = useState(false);
  const [blastDate, setBlastDate] = useState('');
  const [whatsAppBlastDate, setWhatsAppBlastDate] = useState('');
  const [selectedBlastOutlet, setSelectedBlastOutlet] = useState('');
  const [selectedWhatsAppOutlet, setSelectedWhatsAppOutlet] = useState('');
  const [showEmailPreview, setShowEmailPreview] = useState(true);
  const [showWhatsAppPreview, setShowWhatsAppPreview] = useState(true);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailQuota, setEmailQuota] = useState<EmailQuotaInfo | null>(null);
  const [isQuotaLoading, setIsQuotaLoading] = useState(false);
  const [alokasiEmailTemplate, setAlokasiEmailTemplate] = useState(defaultAlokasiBlastEmailTemplate);
  const [alokasiWhatsAppTemplate, setAlokasiWhatsAppTemplate] = useState(defaultAlokasiBlastWhatsAppTemplate);
  const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
  const canEditData = canModifyDatabase(currentUser?.role, 'anggaran', 'edit', roleDatabasePermissionMap);
  const canDeleteData = canModifyDatabase(currentUser?.role, 'anggaran', 'delete', roleDatabasePermissionMap);

  useEscapeToClose(isFormOpen && !isSaving, () => setIsFormOpen(false));
  useEscapeToClose(isConfirmOpen && !isSaving, () => setIsConfirmOpen(false));
  useEscapeToClose(isBlastOpen && !isSendingEmail, () => setIsBlastOpen(false));
  useEscapeToClose(isWhatsAppBlastOpen, () => setIsWhatsAppBlastOpen(false));

  const ensureSheet = async () => {
    if (!spreadsheetId) throw new Error('Spreadsheet ID belum dikonfigurasi');
    await googleSheetsService.ensureSheet(spreadsheetId, sheetName);
    const header = await googleSheetsService.readData(spreadsheetId, `${sheetName}!A1:G1`);
    if (!header?.[0]?.some((value: unknown) => String(value || '').trim())) await googleSheetsService.updateData(spreadsheetId, `${sheetName}!A1:G1`, [headers]);
  };

  const fetchData = async () => {
    if (!spreadsheetId) return toast.error('Spreadsheet ID belum dikonfigurasi');
    setIsLoading(true);
    try {
      const [sheetId, cabang] = await Promise.all([googleSheetsService.getSheetIdByName(spreadsheetId, sheetName), cabangService.getAll()]);
      const values = sheetId === null ? [] : await googleSheetsService.readData(spreadsheetId, `${sheetName}!A2:G`);
      setRawData((values || []).filter((row: any[]) => row.some(value => String(value || '').trim())).map((row: any[], index: number) => ({ rowIndex: index + 2, tanggal: String(row[0] || ''), kodeOutlet: String(row[1] || ''), namaOutlet: String(row[2] || ''), kebutuhanAnggaran: String(row[3] || ''), mataAnggaran: String(row[4] || ''), kodeActivity: String(row[5] || ''), nominalPersetujuan: parseAmount(row[6]) })));
      setCabangMaster(cabang);
    } catch (error: any) {
      console.error('Data Alokasi fetch error:', error);
      toast.error(`Gagal memuat Data Alokasi: ${error.message}`);
    } finally { setIsLoading(false); }
  };

  useEffect(() => {
    fetchData();
    blastTemplateService.getAlokasiTemplate().then(setAlokasiEmailTemplate).catch(error => console.error('Alokasi email template load error:', error));
    blastTemplateService.getAlokasiWhatsAppTemplate().then(setAlokasiWhatsAppTemplate).catch(error => console.error('Alokasi WhatsApp template load error:', error));
  }, []);
  useEffect(() => { if (!isBlastOpen) return; setIsQuotaLoading(true); emailBlastService.getQuota().then(setEmailQuota).catch(() => setEmailQuota(null)).finally(() => setIsQuotaLoading(false)); }, [isBlastOpen]);

  const outletCodeOptions = useMemo(() => Array.from(new Set(rawData.map(item => item.kodeOutlet).filter(Boolean))).sort().map(value => ({ value, label: value })), [rawData]);
  const mataAnggaranOptions = useMemo(() => Array.from(new Set(rawData.map(item => item.mataAnggaran).filter(Boolean))).sort().map(value => ({ value, label: value })), [rawData]);
  const filteredData = useMemo(() => rawData.filter(item => {
    const keyword = searchTerm.toLowerCase().trim();
    const matchesSearch = !keyword || [item.tanggal, item.kodeOutlet, item.namaOutlet, item.kebutuhanAnggaran, item.mataAnggaran, item.kodeActivity, String(item.nominalPersetujuan), formatCurrency(item.nominalPersetujuan)].some(value => String(value).toLowerCase().includes(keyword));
    const date = toComparableDate(item.tanggal);
    return matchesSearch && (!selectedOutletCode || item.kodeOutlet === selectedOutletCode.value) && (!selectedMataAnggaran || item.mataAnggaran === selectedMataAnggaran.value) && (!startDate || (date && date >= startDate)) && (!endDate || (date && date <= endDate));
  }), [rawData, searchTerm, selectedOutletCode, selectedMataAnggaran, startDate, endDate]);
  useEffect(() => { setCurrentPage(1); }, [searchTerm, selectedOutletCode, selectedMataAnggaran, startDate, endDate, itemsPerPage]);
  useEffect(() => { const visible = new Set(filteredData.map(item => item.rowIndex)); setSelectedRows(prev => prev.filter(id => visible.has(id))); }, [filteredData]);
  const paginatedData = useMemo(() => itemsPerPage === 'all' ? filteredData : filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredData, currentPage, itemsPerPage]);
  const totalPages = itemsPerPage === 'all' ? 1 : Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const allPageRowsSelected = paginatedData.length > 0 && paginatedData.every(item => selectedRows.includes(item.rowIndex));
  const cabangByName = useMemo(() => cabangMaster.reduce<Record<string, Cabang>>((acc, item) => ({ ...acc, [normalizeText(item.nama)]: item }), {}), [cabangMaster]);
  const dateSummary = useMemo(() => Object.values(rawData.reduce<Record<string, { tanggal: string; count: number; totalNominal: number }>>((acc, item) => { if (!item.tanggal) return acc; if (!acc[item.tanggal]) acc[item.tanggal] = { tanggal: item.tanggal, count: 0, totalNominal: 0 }; acc[item.tanggal].count += 1; acc[item.tanggal].totalNominal += item.nominalPersetujuan; return acc; }, {})).sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal))), [rawData]);
  const groupByOutlet = (date: string) => Object.values(rawData.filter(item => item.tanggal === date).reduce<Record<string, OutletBlastGroup>>((acc, item) => { const key = item.namaOutlet || 'TANPA OUTLET'; const cabang = cabangByName[normalizeText(key)]; if (!acc[key]) acc[key] = { tanggal: item.tanggal, outlet: key, email: String(cabang?.email || ''), whatsapp: normalizeWhatsapp(cabang?.whatsapp), rows: [], totalNominal: 0 }; acc[key].rows.push(item); acc[key].totalNominal += item.nominalPersetujuan; return acc; }, {})).sort((a, b) => a.outlet.localeCompare(b.outlet));
  const blastGroups = useMemo(() => groupByOutlet(blastDate), [blastDate, rawData, cabangByName]);
  const whatsAppGroups = useMemo(() => groupByOutlet(whatsAppBlastDate), [whatsAppBlastDate, rawData, cabangByName]);
  const selectedBlastGroup = blastGroups.find(group => group.outlet === selectedBlastOutlet) || blastGroups[0];
  const selectedWhatsAppGroup = whatsAppGroups.find(group => group.outlet === selectedWhatsAppOutlet) || whatsAppGroups[0];
  useEffect(() => { setSelectedBlastOutlet(blastGroups[0]?.outlet || ''); }, [blastDate, blastGroups]);
  useEffect(() => { setSelectedWhatsAppOutlet(whatsAppGroups[0]?.outlet || ''); }, [whatsAppBlastDate, whatsAppGroups]);

  const resetFilters = () => { setSearchTerm(''); setSelectedOutletCode(null); setSelectedMataAnggaran(null); setStartDate(''); setEndDate(''); setSelectedRows([]); setCurrentPage(1); toast.success('Filter telah direset'); };
  const toggleRow = (rowIndex: number) => setSelectedRows(prev => prev.includes(rowIndex) ? prev.filter(id => id !== rowIndex) : [...prev, rowIndex]);
  const toggleAll = () => { const pageRows = paginatedData.map(item => item.rowIndex); setSelectedRows(prev => allPageRowsSelected ? prev.filter(id => !pageRows.includes(id)) : Array.from(new Set([...prev, ...pageRows]))); };
  const openForm = (item?: AlokasiRecord) => { if (!canEditData) return toast.error('Anda tidak memiliki akses untuk mengubah Data Alokasi'); setIsEditing(Boolean(item)); setFormData(item ? { ...item } : blankRecord()); setIsFormOpen(true); };
  const saveForm = async () => {
    if (!canEditData) return toast.error('Anda tidak memiliki akses untuk menyimpan Data Alokasi');
    if (!spreadsheetId) return toast.error('Spreadsheet ID belum dikonfigurasi');
    if (!formData.tanggal || !formData.kodeOutlet || !formData.namaOutlet || !formData.kebutuhanAnggaran || !formData.mataAnggaran || !formData.kodeActivity) return toast.error('Lengkapi seluruh kolom Data Alokasi');
    if (!Number.isFinite(formData.nominalPersetujuan) || formData.nominalPersetujuan < 0) return toast.error('Nominal Persetujuan tidak valid');
    setIsSaving(true);
    try {
      await ensureSheet();
      if (isEditing) { await googleSheetsService.updateData(spreadsheetId, `${sheetName}!A${formData.rowIndex}:G${formData.rowIndex}`, [toSheetRow(formData)]); setRawData(prev => prev.map(item => item.rowIndex === formData.rowIndex ? formData : item)); toast.success('Data Alokasi berhasil diperbarui'); }
      else { await googleSheetsService.appendData(spreadsheetId, `${sheetName}!A:G`, [toSheetRow(formData)]); await fetchData(); toast.success('Data Alokasi berhasil ditambahkan'); }
      setIsFormOpen(false);
    } catch (error: any) { toast.error(`Gagal menyimpan Data Alokasi: ${error.message}`); } finally { setIsSaving(false); }
  };
  const requestDelete = (rowIndex?: number) => { if (!canDeleteData) return toast.error('Anda tidak memiliki akses untuk menghapus Data Alokasi'); if (rowIndex === undefined && !selectedRows.length) return toast.error('Pilih data yang akan dihapus terlebih dahulu'); setIsBulkDelete(rowIndex === undefined); setRowToDelete(rowIndex ?? null); setIsConfirmOpen(true); };
  const confirmDelete = async () => {
    if (!spreadsheetId) return toast.error('Spreadsheet ID belum dikonfigurasi'); const rows = isBulkDelete ? selectedRows : rowToDelete === null ? [] : [rowToDelete]; if (!rows.length) return;
    setIsSaving(true); try { const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, sheetName); if (sheetId === null) throw new Error(`Sheet ${sheetName} tidak ditemukan`); await googleSheetsService.deleteRows(spreadsheetId, sheetId, rows.map(row => row - 1)); setSelectedRows([]); setIsConfirmOpen(false); await fetchData(); toast.success(`${rows.length} data berhasil dihapus`); } catch (error: any) { toast.error(`Gagal menghapus Data Alokasi: ${error.message}`); } finally { setIsSaving(false); }
  };
  const exportExcel = () => { const worksheet = XLSX.utils.json_to_sheet(filteredData.map(item => ({ Tanggal: item.tanggal, 'Kode Outlet': item.kodeOutlet, 'Nama Outlet': item.namaOutlet, 'Kebutuhan Anggaran': item.kebutuhanAnggaran, 'Mata Anggaran': item.mataAnggaran, 'Kode Activity': item.kodeActivity, 'Nominal Persetujuan': item.nominalPersetujuan }))); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Alokasi'); XLSX.writeFile(workbook, `Data_Alokasi_${new Date().toISOString().slice(0, 10)}.xlsx`); setIsExportOpen(false); };
  const exportPdf = () => { const doc = new jsPDF('l', 'mm', 'a4'); doc.text('Data Alokasi', 14, 15); autoTable(doc, { startY: 20, head: [headers], body: filteredData.map(item => [item.tanggal, item.kodeOutlet, item.namaOutlet, item.kebutuhanAnggaran, item.mataAnggaran, item.kodeActivity, formatCurrency(item.nominalPersetujuan)]), styles: { fontSize: 6 }, columnStyles: { 6: { halign: 'right' } } }); doc.save(`Data_Alokasi_${new Date().toISOString().slice(0, 10)}.pdf`); setIsExportOpen(false); };
  const allocationDetailRowsHtml = (group: OutletBlastGroup) => group.rows.map((item, index) => `<tr style="border-bottom: 1px solid #e5e7eb;"><td style="padding: 10px;">${index + 1}</td><td style="padding: 10px; font-weight: 700;">${item.mataAnggaran}</td><td style="padding: 10px;">${item.kodeActivity}</td><td style="padding: 10px; text-align: right; font-weight: 700; color: #1d4ed8;">${formatCurrency(item.nominalPersetujuan)}</td></tr>`).join('');
  const allocationDetailRowsText = (group: OutletBlastGroup) => group.rows.map((item, index) => `${index + 1}. ${item.mataAnggaran}\n   Kode Activity: ${item.kodeActivity}\n   Nominal: ${formatCurrency(item.nominalPersetujuan)}`).join('\n\n');
  const emailBody = (group: OutletBlastGroup) => alokasiEmailTemplate
    .replaceAll('{{outlet}}', group.outlet)
    .replaceAll('{{cabang}}', group.outlet)
    .replaceAll('{{tanggal}}', group.tanggal)
    .replaceAll('{{jumlahTransaksi}}', String(group.rows.length))
    .replaceAll('{{totalNominal}}', formatCurrency(group.totalNominal))
    .replaceAll('{{detailRows}}', allocationDetailRowsHtml(group));
  const whatsappMessage = (group: OutletBlastGroup) => {
    const detailRows = allocationDetailRowsText(group);
    const rendered = alokasiWhatsAppTemplate
      .replaceAll('{{1}}', group.outlet)
      .replaceAll('{{2}}', group.tanggal)
      .replaceAll('{{3}}', String(group.rows.length))
      .replaceAll('{{4}}', formatCurrency(group.totalNominal))
      .replaceAll('{{5}}', detailRows)
      .replaceAll('{{outlet}}', group.outlet)
      .replaceAll('{{cabang}}', group.outlet)
      .replaceAll('{{tanggal}}', group.tanggal)
      .replaceAll('{{jumlahTransaksi}}', String(group.rows.length))
      .replaceAll('{{totalNominal}}', formatCurrency(group.totalNominal))
      .replaceAll('{{detailRows}}', detailRows);
    return alokasiWhatsAppTemplate.includes('{{5}}') || alokasiWhatsAppTemplate.includes('{{detailRows}}') ? rendered : `${rendered}\n\nRincian transaksi:\n${detailRows}`;
  };
  const sendEmail = async () => { if (!blastDate) return toast.error('Pilih satu tanggal terlebih dahulu'); const ready = blastGroups.filter(group => group.email); if (!ready.length) return toast.error('Tidak ada email outlet pada data terpilih'); const messages: BlastEmailMessage[] = ready.map(group => ({ to: group.email, subject: `Data Alokasi ${group.outlet} - ${group.tanggal}`, plainBody: whatsappMessage(group), htmlBody: emailBody(group), cabang: group.outlet, tanggal: group.tanggal, totalNominal: group.totalNominal, totalTransaksi: group.rows.length })); const toastId = toast.loading(`Mengirim ${messages.length} email...`); setIsSendingEmail(true); try { const result = await emailBlastService.sendEmails(messages); setEmailQuota({ remainingDailyQuota: typeof result.remainingDailyQuota === 'number' ? result.remainingDailyQuota : emailQuota?.remainingDailyQuota ?? null, sentToday: Number(result.sentToday || 0) }); toast.success(`${Number(result.sent || messages.length)} email berhasil dikirim`, { id: toastId }); } catch (error: any) { toast.error(`Gagal mengirim email: ${error.message}`, { id: toastId }); } finally { setIsSendingEmail(false); } };
  const sendWhatsapp = (group: OutletBlastGroup) => { if (!isValidWhatsapp(group.whatsapp)) return toast.error(`Nomor WhatsApp ${group.outlet} belum valid`); window.open(`https://wa.me/${group.whatsapp}?text=${encodeURIComponent(whatsappMessage(group))}`, '_blank', 'noopener,noreferrer'); };

  const renderBlastModal = (whatsapp: boolean) => {
    const date = whatsapp ? whatsAppBlastDate : blastDate;
    const setDate = whatsapp ? setWhatsAppBlastDate : setBlastDate;
    const groups = whatsapp ? whatsAppGroups : blastGroups;
    const selected = whatsapp ? selectedWhatsAppGroup : selectedBlastGroup;
    const setSelected = whatsapp ? setSelectedWhatsAppOutlet : setSelectedBlastOutlet;
    const showPreview = whatsapp ? showWhatsAppPreview : showEmailPreview;
    const togglePreview = whatsapp ? setShowWhatsAppPreview : setShowEmailPreview;
    const close = () => whatsapp ? setIsWhatsAppBlastOpen(false) : setIsBlastOpen(false);
    return <AnimatedModal isOpen={whatsapp ? isWhatsAppBlastOpen : isBlastOpen} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"><div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"><div className="flex flex-col justify-between gap-3 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center"><div><h2 className="text-lg font-black text-gray-800">Blast {whatsapp ? 'WhatsApp' : 'Email'} Data Alokasi</h2><p className="text-xs text-gray-500">{whatsapp ? 'Metode manual via wa.me.' : 'Email outlet dibaca dari Firebase collection cabang.'}</p></div><div className="flex flex-wrap items-center gap-2">{!whatsapp && <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">{isQuotaLoading ? 'Cek quota...' : `Terkirim hari ini: ${emailQuota?.sentToday ?? '-'} | Sisa quota: ${emailQuota?.remainingDailyQuota ?? '-'}`}</div>}<select value={date} onChange={event => setDate(event.target.value)} className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700"><option value="">Pilih tanggal</option>{dateSummary.map(item => <option key={item.tanggal} value={item.tanggal}>{item.tanggal}</option>)}</select>{!whatsapp && <button onClick={sendEmail} disabled={isSendingEmail || !blastDate} className="flex items-center gap-2 rounded-lg bg-[#009B4F] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{isSendingEmail ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{isSendingEmail ? 'Mengirim...' : 'Send Email'}</button>}<button onClick={() => togglePreview(prev => !prev)} className="flex h-9 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-bold text-gray-700">{showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showPreview ? 'Hide Preview' : 'Show Preview'}</button><button onClick={close} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button></div></div><div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto bg-gray-50/50 p-4 xl:grid-cols-[360px_1fr]"><div className="overflow-hidden rounded-xl border border-gray-100 bg-white"><div className="border-b border-gray-100 px-4 py-3"><h3 className="text-sm font-black">Ringkasan by Tanggal</h3></div><div className="max-h-[58vh] overflow-auto"><table className="w-full text-[11px]"><thead className="sticky top-0 bg-gray-50"><tr><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-center">Trx</th><th className="px-3 py-2 text-right">Nominal</th></tr></thead><tbody>{dateSummary.map(item => <tr key={item.tanggal} onClick={() => setDate(item.tanggal)} className={`cursor-pointer border-t ${date === item.tanggal ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}><td className="px-3 py-2 font-bold">{item.tanggal}</td><td className="px-3 py-2 text-center">{item.count}</td><td className="px-3 py-2 text-right font-mono">{formatCurrency(item.totalNominal)}</td></tr>)}</tbody></table></div></div><div className={`grid min-h-0 grid-cols-1 gap-4 ${showPreview ? 'lg:grid-cols-[1.1fr_0.9fr]' : ''}`}><div className="overflow-hidden rounded-xl border border-gray-100 bg-white"><div className="border-b border-gray-100 px-4 py-3"><h3 className="text-sm font-black">Daftar Outlet</h3></div><div className="max-h-[58vh] overflow-auto"><table className="w-full min-w-[720px] text-[11px]"><thead className="sticky top-0 bg-[#005245] text-white"><tr><th className="px-3 py-2 text-left">NAMA OUTLET</th><th className="px-3 py-2 text-left">{whatsapp ? 'WHATSAPP' : 'EMAIL'}</th><th className="px-3 py-2 text-center">TRX</th><th className="px-3 py-2 text-right">NOMINAL</th>{whatsapp && <th className="px-3 py-2 text-center">AKSI</th>}</tr></thead><tbody>{groups.length ? groups.map(group => <tr key={group.outlet} onClick={() => setSelected(group.outlet)} className={`cursor-pointer border-t ${selected?.outlet === group.outlet ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}><td className="px-3 py-2 font-bold">{group.outlet}</td><td className={`px-3 py-2 ${whatsapp && !isValidWhatsapp(group.whatsapp) ? 'font-bold text-red-600' : ''}`}>{whatsapp ? group.whatsapp || 'Belum ada nomor' : group.email || 'Belum ada email'}</td><td className="px-3 py-2 text-center">{group.rows.length}</td><td className="px-3 py-2 text-right font-mono font-bold text-blue-600">{formatCurrency(group.totalNominal)}</td>{whatsapp && <td className="px-3 py-2 text-center"><button onClick={event => { event.stopPropagation(); sendWhatsapp(group); }} disabled={!isValidWhatsapp(group.whatsapp)} className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:bg-gray-300"><MessageCircle className="h-3.5 w-3.5" />Send WhatsApp</button></td>}</tr>) : <tr><td colSpan={whatsapp ? 5 : 4} className="px-3 py-10 text-center italic text-gray-400">Pilih tanggal untuk menampilkan data</td></tr>}</tbody></table></div></div>{showPreview && <div className="min-h-0 overflow-auto rounded-xl border border-gray-100 bg-white"><div className="border-b border-gray-100 px-4 py-3"><h3 className="text-sm font-black">Preview {whatsapp ? 'Pesan WhatsApp' : 'Blast Email'}</h3></div><div className="p-4">{selected ? whatsapp ? <pre className="whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-[12px] leading-relaxed">{whatsappMessage(selected)}</pre> : <div dangerouslySetInnerHTML={{ __html: emailBody(selected) }} /> : <p className="text-sm italic text-gray-400">Pilih tanggal untuk melihat preview.</p>}</div></div>}</div></div></div></AnimatedModal>;
  };

  return <div className="flex h-full min-h-0 flex-col"><div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"><div className="flex-shrink-0 border-b border-gray-100 p-3"><div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#009B4F]/10 text-[#009B4F]"><WalletCards className="h-5 w-5" /></div><div><h1 className="text-xl font-bold text-gray-800">Data Alokasi</h1><p className="text-xs text-gray-500">Monitoring dan pengelolaan alokasi anggaran outlet</p></div></div><div className="flex flex-wrap items-center gap-2">{canEditData && <button onClick={() => openForm()} className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-blue-600/10 hover:bg-blue-700"><Plus className="h-4 w-4" />Tambah Data</button>}<button onClick={() => setIsBlastOpen(true)} className="flex cursor-pointer items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600"><Mail className="h-4 w-4" />Blast Email</button><button onClick={() => setIsWhatsAppBlastOpen(true)} className="flex cursor-pointer items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700"><MessageCircle className="h-4 w-4" />Blast WhatsApp</button><div className="relative"><button onClick={() => setIsExportOpen(prev => !prev)} className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#009B4F] px-3 py-2 text-xs font-bold text-white hover:bg-[#008543]"><Download className="h-4 w-4" />Export Data</button>{isExportOpen && <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-2 shadow-xl"><button onClick={exportExcel} className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-[#009B4F]"><FileSpreadsheet className="h-4 w-4 text-green-600" />Excel (.xlsx)</button><button onClick={exportPdf} className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-[#009B4F]"><FileText className="h-4 w-4 text-red-600" />PDF (.pdf)</button></div>}</div>{selectedRows.length > 0 && canDeleteData && <button onClick={() => requestDelete()} className="flex cursor-pointer items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700"><Trash2 className="h-4 w-4" />Hapus ({selectedRows.length})</button>}</div></div><div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Cari outlet, mata anggaran, activity, atau kebutuhan..." className="h-[36px] w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 text-xs outline-none focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20" /></div><div className="flex items-center gap-2"><button onClick={resetFilters} className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-red-50 hover:text-red-600"><XCircle className="h-4 w-4" />Reset</button><button onClick={fetchData} className={`cursor-pointer rounded-lg bg-gray-50 p-2 text-gray-500 hover:bg-gray-100 ${isLoading ? 'animate-spin' : ''}`} title="Refresh Data"><RefreshCw className="h-4 w-4" /></button></div></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"><Select options={outletCodeOptions} value={selectedOutletCode} onChange={setSelectedOutletCode} placeholder="Filter Kode Outlet..." isClearable isSearchable styles={selectStyles} menuPortalTarget={document.body} menuPosition="fixed" /><Select options={mataAnggaranOptions} value={selectedMataAnggaran} onChange={setSelectedMataAnggaran} placeholder="Filter Mata Anggaran..." isClearable isSearchable styles={selectStyles} menuPortalTarget={document.body} menuPosition="fixed" /><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="h-[36px] rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#009B4F]" title="Tanggal Mulai" /><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="h-[36px] rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#009B4F]" title="Tanggal Akhir" /></div></div><div className="min-h-0 flex-1 overflow-auto bg-gray-50/30"><table className="w-full min-w-[1550px] border-collapse text-[12px]"><thead className="sticky top-0 z-20"><tr className="border-b border-[#004237] bg-[#005245]"><th className="w-12 border-r border-[#004237]/50 px-3 py-1.5 text-center text-white">{canDeleteData && <button onClick={toggleAll}>{allPageRowsSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</button>}</th>{['No', ...headers, 'Aksi'].map(label => <th key={label} className={`border-r border-[#004237]/50 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white ${['No', 'Aksi'].includes(label) ? 'text-center' : label === 'Nominal Persetujuan' ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100 bg-white">{isLoading ? <tr><td colSpan={10} className="py-16 text-center text-sm text-gray-400">Memuat data...</td></tr> : paginatedData.length ? paginatedData.map((item, index) => <tr key={item.rowIndex} className={`${index % 2 ? 'bg-gray-50/50' : 'bg-white'} hover:bg-emerald-50/40`}><td className="border-r border-gray-50 px-3 py-1 text-center">{canDeleteData && <button onClick={() => toggleRow(item.rowIndex)}>{selectedRows.includes(item.rowIndex) ? <CheckSquare className="h-4 w-4 text-[#009B4F]" /> : <Square className="h-4 w-4 text-gray-300" />}</button>}</td><td className="border-r border-gray-50 px-3 py-1 text-center font-mono text-gray-400">{itemsPerPage === 'all' ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1}</td><td className="border-r border-gray-50 px-4 py-1 font-semibold">{item.tanggal}</td><td className="border-r border-gray-50 px-4 py-1 font-mono">{item.kodeOutlet}</td><td className="border-r border-gray-50 px-4 py-1 font-bold">{item.namaOutlet}</td><td className="border-r border-gray-50 px-4 py-1">{item.kebutuhanAnggaran}</td><td className="border-r border-gray-50 px-4 py-1">{item.mataAnggaran}</td><td className="border-r border-gray-50 px-4 py-1 font-mono">{item.kodeActivity}</td><td className="border-r border-gray-50 px-4 py-1 text-right font-mono font-bold text-blue-600">{formatCurrency(item.nominalPersetujuan)}</td><td className="px-4 py-1 text-center"><div className="flex justify-center gap-1">{canEditData && <button onClick={() => openForm(item)} className="rounded-lg bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>}{canDeleteData && <button onClick={() => requestDelete(item.rowIndex)} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50" title="Hapus"><Trash2 className="h-3.5 w-3.5" /></button>}</div></td></tr>) : <tr><td colSpan={10} className="py-20 text-center text-sm italic text-gray-400">Tidak ada data alokasi ditemukan</td></tr>}</tbody></table></div><div className="flex flex-shrink-0 flex-col items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-2 sm:flex-row"><div className="text-xs font-medium text-gray-500">Menampilkan <b className="text-gray-900">{paginatedData.length}</b> dari <b className="text-gray-900">{filteredData.length}</b> baris data</div><div className="flex items-center gap-4"><div className="flex items-center gap-2"><span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Show Data</span><PageSizeDropdown options={pageSizeOptions} value={itemsPerPage} onChange={setItemsPerPage} className="w-16" /></div>{itemsPerPage !== 'all' && <div className="flex items-center gap-1"><button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span className="px-2 text-xs font-bold">{currentPage} <span className="text-gray-400">/</span> {totalPages}</span><button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div>}</div></div></div><AnimatedModal isOpen={isFormOpen} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-gray-100 px-5 py-4"><h2 className="text-lg font-black text-gray-800">{isEditing ? 'Edit Data Alokasi' : 'Tambah Data Alokasi'}</h2><button onClick={() => setIsFormOpen(false)} disabled={isSaving} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button></div><div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2"><label className="text-xs font-bold text-gray-600">Tanggal<input type="date" value={toComparableDate(formData.tanggal)} onChange={event => setFormData(prev => ({ ...prev, tanggal: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label><label className="text-xs font-bold text-gray-600">Kode Outlet<input value={formData.kodeOutlet} onChange={event => setFormData(prev => ({ ...prev, kodeOutlet: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label><label className="text-xs font-bold text-gray-600 sm:col-span-2">Nama Outlet<input value={formData.namaOutlet} onChange={event => setFormData(prev => ({ ...prev, namaOutlet: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label><label className="text-xs font-bold text-gray-600">Kebutuhan Anggaran<input value={formData.kebutuhanAnggaran} onChange={event => setFormData(prev => ({ ...prev, kebutuhanAnggaran: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label><label className="text-xs font-bold text-gray-600">Mata Anggaran<input value={formData.mataAnggaran} onChange={event => setFormData(prev => ({ ...prev, mataAnggaran: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label><label className="text-xs font-bold text-gray-600">Kode Activity<input value={formData.kodeActivity} onChange={event => setFormData(prev => ({ ...prev, kodeActivity: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label><label className="text-xs font-bold text-gray-600">Nominal Persetujuan<input type="number" min="0" value={formData.nominalPersetujuan || ''} onChange={event => setFormData(prev => ({ ...prev, nominalPersetujuan: Number(event.target.value) || 0 }))} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label></div><div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4"><button onClick={() => setIsFormOpen(false)} disabled={isSaving} className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold">Batal</button><button onClick={saveForm} disabled={isSaving} className="rounded-lg bg-[#009B4F] px-5 py-2 text-xs font-bold text-white">{isSaving ? 'Menyimpan...' : 'Simpan'}</button></div></div></AnimatedModal>{renderBlastModal(false)}{renderBlastModal(true)}<ConfirmModal isOpen={isConfirmOpen} title={isBulkDelete ? 'Konfirmasi Hapus Massal' : 'Konfirmasi Hapus Data'} message={isBulkDelete ? `Apakah Anda yakin ingin menghapus ${selectedRows.length} data terpilih dari Google Sheets?` : 'Apakah Anda yakin ingin menghapus data ini dari Google Sheets?'} onConfirm={confirmDelete} onCancel={() => setIsConfirmOpen(false)} isLoading={isSaving} /></div>;
}
