import React, { useEffect, useMemo, useState } from 'react';
import { Check, CheckSquare, ChevronLeft, ChevronRight, Download, Edit2, FileSpreadsheet, FileText, GitCompareArrows, RefreshCw, Search, Square, Trash2, X, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { googleSheetsService } from '../services/googleSheetsService';
import { glBankService } from '../services/glBankService';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageSizeDropdown, type PageSizeValue } from '../components/PageSizeDropdown';
import { canModifyDatabase, type RoleDatabasePermissionMap } from '../constants/databasePermissions';

interface DropPollRecord {
  rowIndex: number;
  tanggalRekon: string;
  companyCode: string;
  documentDate: string;
  postingDate: string;
  noBukti: string;
  reference: string;
  dropPool: string;
  profitCenterD: string;
  glAkunD: string;
  profitCenterK: string;
  glAkunK: string;
  amount: number;
  keterangan: string;
}

interface DataDropPollProps {
  currentUser?: any;
  roleDatabasePermissionMap?: RoleDatabasePermissionMap;
}

const sheetName = 'Drop/Poll';
const pageSizeOptions: { value: PageSizeValue; label: string }[] = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 'all', label: 'All' },
];

const dropPoolOptions = [
  { value: 'D', label: 'Dropping' },
  { value: 'P', label: 'Polling' },
];
const bankFilterOrder = ['BNI', 'BRI', 'BSI'];

const selectStyles = {
  control: (base: any) => ({
    ...base,
    borderRadius: '0.5rem',
    minHeight: '38px',
    height: '38px',
    backgroundColor: 'white',
    borderColor: '#e5e7eb',
    fontSize: '0.875rem',
    boxShadow: 'none',
    '&:hover': { borderColor: '#009B4F' },
  }),
  placeholder: (base: any) => ({ ...base, color: '#9ca3af' }),
  singleValue: (base: any) => ({ ...base, color: '#374151' }),
  menu: (base: any) => ({ ...base, borderRadius: '0.5rem', overflow: 'hidden', zIndex: 50 }),
  menuPortal: (base: any) => ({ ...base, zIndex: 140 }),
  option: (base: any, state: any) => ({
    ...base,
    fontSize: '0.875rem',
    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white',
    color: state.isSelected ? 'white' : '#374151',
    '&:active': { backgroundColor: '#009B4F' },
  }),
};

const parseAmount = (value: unknown) => {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return Number(normalized) || 0;
};

const formatNumber = (amount: number) => new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(amount);

const toSheetRow = (row: DropPollRecord) => [
  row.tanggalRekon,
  row.companyCode,
  row.documentDate,
  row.postingDate,
  row.noBukti,
  row.reference,
  row.dropPool,
  row.profitCenterD,
  row.glAkunD,
  row.profitCenterK,
  row.glAkunK,
  row.amount,
  row.keterangan,
];

export function DataDropPoll({ currentUser, roleDatabasePermissionMap = {} }: DataDropPollProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedDropPool, setSelectedDropPool] = useState<any>(null);
  const [selectedGlD, setSelectedGlD] = useState<any>(null);
  const [selectedGlK, setSelectedGlK] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rawData, setRawData] = useState<DropPollRecord[]>([]);
  const [glOptions, setGlOptions] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeValue>(25);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editData, setEditData] = useState<DropPollRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isBulkDelete, setIsBulkDelete] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);

  const canEditData = canModifyDatabase(currentUser?.role, 'data-rekon', 'edit', roleDatabasePermissionMap);
  const canDeleteData = canModifyDatabase(currentUser?.role, 'data-rekon', 'delete', roleDatabasePermissionMap);

  const fetchData = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    try {
      const [values, glMappings] = await Promise.all([
        googleSheetsService.readData(spreadsheetId, `'${sheetName}'!A2:M`),
        glBankService.getAll(),
      ]);

      const mapped: DropPollRecord[] = (values || []).map((row: any[], index: number) => ({
        rowIndex: index + 2,
        tanggalRekon: row[0] || '',
        companyCode: row[1] || '',
        documentDate: row[2] || '',
        postingDate: row[3] || '',
        noBukti: row[4] || '',
        reference: row[5] || '',
        dropPool: row[6] || '',
        profitCenterD: row[7] || '',
        glAkunD: row[8] || '',
        profitCenterK: row[9] || '',
        glAkunK: row[10] || '',
        amount: parseAmount(row[11]),
        keterangan: row[12] || '',
      }));

      const groupedGl = glMappings.reduce<Record<string, Set<string>>>((acc, item) => {
        const bank = String(item.bank || '').trim().toUpperCase();
        const nomorGL = String(item.nomorGL || '').trim();
        if (!bank || !nomorGL) return acc;
        if (!acc[bank]) acc[bank] = new Set();
        acc[bank].add(nomorGL);
        return acc;
      }, {});

      setRawData(mapped);
      setGlOptions(bankFilterOrder
        .filter(bank => groupedGl[bank])
        .map(bank => ({ value: bank, label: bank, glNumbers: Array.from(groupedGl[bank]) })));
    } catch (error: any) {
      console.error('Data Drop/Poll fetch error:', error);
      toast.error(`Gagal memuat Data Drop/Poll: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredData = useMemo(() => rawData.filter(item => {
    const keyword = searchTerm.trim().toLowerCase();
    const matchSearch = !keyword || [
      item.tanggalRekon,
      item.companyCode,
      item.documentDate,
      item.postingDate,
      item.noBukti,
      item.reference,
      item.dropPool,
      item.profitCenterD,
      item.glAkunD,
      item.profitCenterK,
      item.glAkunK,
      item.keterangan,
      formatNumber(item.amount),
    ].some(value => String(value || '').toLowerCase().includes(keyword));

    const matchDropPool = !selectedDropPool || item.dropPool === selectedDropPool.value;
    const matchGlD = !selectedGlD || selectedGlD.glNumbers.includes(String(item.glAkunD || '').trim());
    const matchGlK = !selectedGlK || selectedGlK.glNumbers.includes(String(item.glAkunK || '').trim());

    let matchDate = true;
    if (startDate || endDate) {
      const itemDate = new Date(item.tanggalRekon);
      if (startDate && itemDate < new Date(startDate)) matchDate = false;
      if (endDate && itemDate > new Date(endDate)) matchDate = false;
    }

    return matchSearch && matchDropPool && matchGlD && matchGlK && matchDate;
  }).sort((a, b) => String(b.tanggalRekon || '').localeCompare(String(a.tanggalRekon || ''))), [rawData, searchTerm, selectedDropPool, selectedGlD, selectedGlK, startDate, endDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedDropPool, selectedGlD, selectedGlK, startDate, endDate, itemsPerPage]);

  useEffect(() => {
    const visibleRows = new Set(filteredData.map(item => item.rowIndex));
    setSelectedRows(prev => prev.filter(rowIndex => visibleRows.has(rowIndex)));
  }, [filteredData]);

  const paginatedData = useMemo(() => {
    if (itemsPerPage === 'all') return filteredData;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const allPageRowsSelected = paginatedData.length > 0 && paginatedData.every(item => selectedRows.includes(item.rowIndex));

  const resetFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setSelectedDropPool(null);
    setSelectedGlD(null);
    setSelectedGlK(null);
    setSelectedRows([]);
    setCurrentPage(1);
    toast.success('Filter telah direset');
  };

  const exportRows = () => filteredData.map(item => ({
    'Tanggal Rekon': item.tanggalRekon,
    'Company Code': item.companyCode,
    'Document Date': item.documentDate,
    'Posting Date': item.postingDate,
    'No. Bukti': item.noBukti,
    Reference: item.reference,
    'Drop / Pool': item.dropPool,
    'Profit Center (D)': item.profitCenterD,
    'GL Akun (D)': item.glAkunD,
    'Profit Center (K)': item.profitCenterK,
    'GL Akun (K)': item.glAkunK,
    Amount: item.amount,
    Keterangan: item.keterangan,
  }));

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(exportRows());
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Drop Poll');
    XLSX.writeFile(workbook, `Data_Drop_Poll_${new Date().toISOString().split('T')[0]}.xlsx`);
    setIsExportOpen(false);
    toast.success('Berhasil mengekspor ke Excel');
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.text('Data Drop/Poll', 14, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Tanggal Rekon', 'Company Code', 'Document Date', 'Posting Date', 'No. Bukti', 'Reference', 'Drop / Pool', 'Profit Center (D)', 'GL Akun (D)', 'Profit Center (K)', 'GL Akun (K)', 'Amount', 'Keterangan']],
      body: filteredData.map(item => [
        item.tanggalRekon,
        item.companyCode,
        item.documentDate,
        item.postingDate,
        item.noBukti,
        item.reference,
        item.dropPool,
        item.profitCenterD,
        item.glAkunD,
        item.profitCenterK,
        item.glAkunK,
        formatNumber(item.amount),
        item.keterangan,
      ]),
      styles: { fontSize: 6 },
    });
    doc.save(`Data_Drop_Poll_${new Date().toISOString().split('T')[0]}.pdf`);
    setIsExportOpen(false);
    toast.success('Berhasil mengekspor ke PDF');
  };

  const handleEdit = (item: DropPollRecord) => {
    if (!canEditData) {
      toast.error('Anda tidak memiliki akses untuk mengedit Data Drop/Poll');
      return;
    }
    setEditingRow(item.rowIndex);
    setEditData({ ...item });
  };

  const handleCancel = () => {
    setEditingRow(null);
    setEditData(null);
  };

  const handleSave = async () => {
    if (!editData) return;
    if (!canEditData) {
      toast.error('Anda tidak memiliki akses untuk mengedit Data Drop/Poll');
      return;
    }

    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsSaving(true);
    try {
      await googleSheetsService.updateData(spreadsheetId, `'${sheetName}'!A${editData.rowIndex}:M${editData.rowIndex}`, [toSheetRow(editData)]);
      setRawData(prev => prev.map(item => item.rowIndex === editData.rowIndex ? editData : item));
      setEditingRow(null);
      setEditData(null);
      toast.success('Data Drop/Poll berhasil disimpan');
    } catch (error: any) {
      console.error('Save Data Drop/Poll error:', error);
      toast.error(`Gagal menyimpan Data Drop/Poll: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSelectAll = () => {
    const pageRowIds = paginatedData.map(item => item.rowIndex);
    if (pageRowIds.every(rowIndex => selectedRows.includes(rowIndex))) {
      setSelectedRows(prev => prev.filter(rowIndex => !pageRowIds.includes(rowIndex)));
      return;
    }

    setSelectedRows(prev => Array.from(new Set([...prev, ...pageRowIds])));
  };

  const toggleSelectRow = (rowIndex: number) => {
    setSelectedRows(prev => (
      prev.includes(rowIndex)
        ? prev.filter(id => id !== rowIndex)
        : [...prev, rowIndex]
    ));
  };

  const handleBulkDelete = () => {
    if (!canDeleteData) {
      toast.error('Anda tidak memiliki akses untuk menghapus Data Drop/Poll');
      return;
    }
    if (selectedRows.length === 0) {
      toast.error('Pilih data yang akan dihapus terlebih dahulu');
      return;
    }

    setIsBulkDelete(true);
    setRowToDelete(null);
    setIsConfirmOpen(true);
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (!canDeleteData) {
      toast.error('Anda tidak memiliki akses untuk menghapus Data Drop/Poll');
      return;
    }
    setIsBulkDelete(false);
    setRowToDelete(rowIndex);
    setIsConfirmOpen(true);
  };

  const confirmDelete = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    const count = isBulkDelete ? selectedRows.length : 1;
    const loadingToast = toast.loading(`Menghapus ${count} data...`);
    setIsLoading(true);
    try {
      const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, sheetName);
      if (sheetId === null) {
        throw new Error(`Sheet ${sheetName} tidak ditemukan`);
      }

      if (isBulkDelete) {
        await googleSheetsService.deleteRows(spreadsheetId, sheetId, selectedRows.map(rowIndex => rowIndex - 1));
      } else if (rowToDelete !== null) {
        await googleSheetsService.deleteRow(spreadsheetId, sheetId, rowToDelete - 1);
      }

      toast.success(`${count} data berhasil dihapus`, { id: loadingToast });
      setSelectedRows([]);
      setRowToDelete(null);
      setIsConfirmOpen(false);
      await fetchData();
    } catch (error: any) {
      console.error('Delete Data Drop/Poll error:', error);
      toast.error(`Gagal menghapus Data Drop/Poll: ${error.message}`, { id: loadingToast });
    } finally {
      setIsLoading(false);
      setIsBulkDelete(false);
    }
  };

  const renderCellInput = (
    value: string,
    onChange: (value: string) => void,
    className = 'text-left',
  ) => (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-7 w-full rounded border border-gray-200 px-2 text-[11px] outline-none focus:border-[#009B4F] ${className}`}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex-shrink-0 border-b border-gray-100 p-3">
          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#009B4F]/10 text-[#009B4F]">
                <GitCompareArrows className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Data Drop/Poll</h1>
                <p className="text-xs text-gray-500">Monitoring data dropping dan polling dari sheet Drop/Poll</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setIsExportOpen(prev => !prev)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#009B4F] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#008543]"
                >
                  <Download className="h-4 w-4" />
                  Export Data
                </button>
                {isExportOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-2 shadow-xl">
                    <button onClick={exportToExcel} className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-emerald-50 hover:text-[#009B4F]">
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      Excel (.xlsx)
                    </button>
                    <button onClick={exportToPDF} className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-emerald-50 hover:text-[#009B4F]">
                      <FileText className="h-4 w-4 text-red-600" />
                      PDF (.pdf)
                    </button>
                  </div>
                )}
              </div>
              {selectedRows.length > 0 && canDeleteData && (
                <button
                  onClick={handleBulkDelete}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-red-600/10 transition-all hover:bg-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Hapus ({selectedRows.length})
                </button>
              )}
            </div>
          </div>

          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Cari Data Drop/Poll..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-[38px] w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={resetFilters} className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600" title="Reset">
                <XCircle className="h-4 w-4" />
                Reset
              </button>
              <button onClick={fetchData} className={`cursor-pointer rounded-lg bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-gray-100 ${isLoading ? 'animate-spin' : ''}`} title="Refresh Data">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Select options={dropPoolOptions} value={selectedDropPool} onChange={setSelectedDropPool} placeholder="Filter Drop / Poll..." isClearable isSearchable={false} className="text-xs" styles={selectStyles} menuPortalTarget={document.body} menuPosition="fixed" />
            <Select options={glOptions} value={selectedGlD} onChange={setSelectedGlD} placeholder="Filter GL Akun (D)..." isClearable isSearchable={false} className="text-xs" styles={selectStyles} menuPortalTarget={document.body} menuPosition="fixed" />
            <Select options={glOptions} value={selectedGlK} onChange={setSelectedGlK} placeholder="Filter GL Akun (K)..." isClearable isSearchable={false} className="text-xs" styles={selectStyles} menuPortalTarget={document.body} menuPosition="fixed" />
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-[38px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20" title="Tanggal Mulai" />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-[38px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20" title="Tanggal Akhir" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-gray-50/30">
          <table className="w-full min-w-[1900px] border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-[#004237] bg-[#005245]">
                <th className="w-12 border-r border-[#004237]/50 px-3 py-1.5 text-center text-[9px] font-black uppercase tracking-widest text-white">
                  {canDeleteData && (
                    <button onClick={toggleSelectAll} className="rounded p-1 transition-colors hover:bg-white/10">
                      {allPageRowsSelected ? <CheckSquare className="h-4 w-4 text-white" /> : <Square className="h-4 w-4 text-white" />}
                    </button>
                  )}
                </th>
                {['No', 'Tanggal Rekon', 'Company Code', 'Document Date', 'Posting Date', 'No. Bukti', 'Reference', 'Drop / Pool', 'Profit Center (D)', 'GL Akun (D)', 'Profit Center (K)', 'GL Akun (K)', 'Amount', 'Keterangan', 'Aksi'].map(label => (
                  <th key={label} className={`border-r border-[#004237]/50 px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-white ${label === 'No' || label === 'Aksi' ? 'text-center' : label === 'Amount' ? 'text-right' : 'text-left'}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={16} className="px-6 py-12 text-center">
                    <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-[#009B4F]/20 border-t-[#009B4F]" />
                    <p className="text-xs font-medium text-gray-400">Memuat data...</p>
                  </td>
                </tr>
              ) : paginatedData.length > 0 ? (
                paginatedData.map((item, index) => {
                  const rowNumber = itemsPerPage === 'all' ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1;
                  const isEditing = editingRow === item.rowIndex;
                  const isSelected = selectedRows.includes(item.rowIndex);

                  return (
                    <tr key={item.rowIndex} className={`group transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40 ${isSelected ? 'bg-emerald-50' : ''}`}>
                      <td className="border-r border-gray-50 px-3 py-0.5 text-center">
                        {canDeleteData && (
                          <button onClick={() => toggleSelectRow(item.rowIndex)} className="rounded p-1 transition-colors hover:bg-gray-100">
                            {isSelected ? <CheckSquare className="h-4 w-4 text-[#009B4F]" /> : <Square className="h-4 w-4 text-gray-300" />}
                          </button>
                        )}
                      </td>
                      <td className="border-r border-gray-50 px-3 py-0.5 text-center font-mono text-[11px] text-gray-400">{rowNumber}</td>
                      <td className="whitespace-nowrap border-r border-gray-50 px-4 py-0.5 text-[11px] font-semibold text-gray-600">{isEditing ? renderCellInput(editData?.tanggalRekon || '', value => setEditData(prev => prev ? { ...prev, tanggalRekon: value } : null)) : item.tanggalRekon}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px]">{isEditing ? renderCellInput(editData?.companyCode || '', value => setEditData(prev => prev ? { ...prev, companyCode: value } : null)) : item.companyCode}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px]">{isEditing ? renderCellInput(editData?.documentDate || '', value => setEditData(prev => prev ? { ...prev, documentDate: value } : null)) : item.documentDate}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px]">{isEditing ? renderCellInput(editData?.postingDate || '', value => setEditData(prev => prev ? { ...prev, postingDate: value } : null)) : item.postingDate}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px]">{isEditing ? renderCellInput(editData?.noBukti || '', value => setEditData(prev => prev ? { ...prev, noBukti: value } : null)) : item.noBukti}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px]">{isEditing ? renderCellInput(editData?.reference || '', value => setEditData(prev => prev ? { ...prev, reference: value } : null)) : item.reference}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-center">
                        {isEditing ? (
                          <select
                            value={editData?.dropPool || 'D'}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, dropPool: event.target.value } : null)}
                            className="h-7 rounded border border-gray-200 bg-white px-2 text-center text-[11px] font-bold outline-none focus:border-[#009B4F]"
                          >
                            <option value="D">D</option>
                            <option value="P">P</option>
                          </select>
                        ) : (
                          <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${item.dropPool === 'P' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {item.dropPool || '-'}
                          </span>
                        )}
                      </td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px]">{isEditing ? renderCellInput(editData?.profitCenterD || '', value => setEditData(prev => prev ? { ...prev, profitCenterD: value } : null)) : item.profitCenterD}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 font-mono text-[11px]">{isEditing ? renderCellInput(editData?.glAkunD || '', value => setEditData(prev => prev ? { ...prev, glAkunD: value } : null)) : item.glAkunD}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px]">{isEditing ? renderCellInput(editData?.profitCenterK || '', value => setEditData(prev => prev ? { ...prev, profitCenterK: value } : null)) : item.profitCenterK}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 font-mono text-[11px]">{isEditing ? renderCellInput(editData?.glAkunK || '', value => setEditData(prev => prev ? { ...prev, glAkunK: value } : null)) : item.glAkunK}</td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-right font-mono text-[11px] font-black text-blue-600">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData?.amount || 0}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, amount: Number(event.target.value) || 0 } : null)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-right text-[11px] outline-none focus:border-[#009B4F]"
                          />
                        ) : formatNumber(item.amount)}
                      </td>
                      <td className="max-w-xs truncate border-r border-gray-50 px-4 py-0.5 text-[11px] font-medium text-gray-700 group-hover:whitespace-normal">
                        {isEditing ? renderCellInput(editData?.keterangan || '', value => setEditData(prev => prev ? { ...prev, keterangan: value } : null)) : item.keterangan}
                      </td>
                      <td className="px-4 py-0.5 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={handleSave} disabled={isSaving} className="rounded-lg bg-green-100 p-1.5 text-green-600 transition-colors hover:bg-green-200 disabled:opacity-50" title="Simpan">
                              <Check className={`h-3.5 w-3.5 ${isSaving ? 'animate-pulse' : ''}`} />
                            </button>
                            <button onClick={handleCancel} disabled={isSaving} className="rounded-lg bg-red-100 p-1.5 text-red-600 transition-colors hover:bg-red-200 disabled:opacity-50" title="Batal">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {canEditData && (
                              <button onClick={() => handleEdit(item)} className="rounded-lg bg-blue-50 p-1.5 text-blue-600 transition-colors hover:bg-blue-100" title="Edit Baris">
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDeleteData && (
                              <button onClick={() => handleDeleteRow(item.rowIndex)} className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50" title="Hapus Data">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={16} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Search className="h-8 w-8 opacity-20" />
                      <p className="text-sm italic">Tidak ada data Drop/Poll ditemukan</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-shrink-0 flex-col items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-2 sm:flex-row">
          <div className="text-xs font-medium text-gray-500">
            Menampilkan <span className="font-bold text-gray-900">{paginatedData.length}</span> dari <span className="font-bold text-gray-900">{filteredData.length}</span> baris data
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Show Data</span>
              <PageSizeDropdown options={pageSizeOptions} value={itemsPerPage} onChange={setItemsPerPage} className="w-16" />
            </div>
            {itemsPerPage !== 'all' && (
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-1 px-2">
                  <span className="text-xs font-bold text-gray-900">{currentPage}</span>
                  <span className="text-xs text-gray-400">/</span>
                  <span className="text-xs text-gray-500">{totalPages}</span>
                </div>
                <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={isConfirmOpen}
        title={isBulkDelete ? 'Konfirmasi Hapus Massal' : 'Konfirmasi Hapus Data'}
        message={isBulkDelete
          ? `Apakah Anda yakin ingin menghapus ${selectedRows.length} data terpilih dari Google Sheets? Tindakan ini tidak dapat dibatalkan.`
          : 'Apakah Anda yakin ingin menghapus data ini dari Google Sheets? Tindakan ini tidak dapat dibatalkan.'
        }
        onConfirm={confirmDelete}
        onCancel={() => {
          setIsConfirmOpen(false);
          setRowToDelete(null);
        }}
      />
    </div>
  );
}
