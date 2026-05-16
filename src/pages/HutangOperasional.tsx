import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  FileSpreadsheet,
  FileText,
  Landmark,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { googleSheetsService } from '../services/googleSheetsService';
import { useNotifications } from '../contexts/NotificationContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageSizeDropdown, type PageSizeValue } from '../components/PageSizeDropdown';

interface HutangRecord {
  rowIndex: number;
  tanggal: string;
  akunDb: string;
  akunCr: string;
  nominal: number;
  keterangan: string;
  status: string;
  tanggalSelesai: string;
}

interface NewHutangRow {
  tanggal: string;
  akunDb: string;
  akunCr: string;
  nominal: string;
  keterangan: string;
  status: string;
  tanggalSelesai: string;
}

const sheetName = 'HutOpr';
const pageSizeOptions: { value: PageSizeValue; label: string }[] = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 'all', label: 'All' },
];
const defaultStatusOptions = [
  { value: 'Belum', label: 'Belum' },
  { value: 'Hold', label: 'Hold' },
  { value: 'Selesai', label: 'Selesai' },
];
const addRowFields: (keyof NewHutangRow)[] = ['tanggal', 'akunDb', 'akunCr', 'nominal', 'keterangan', 'status', 'tanggalSelesai'];

const createBlankRow = (): NewHutangRow => ({
  tanggal: '',
  akunDb: '',
  akunCr: '',
  nominal: '',
  keterangan: '',
  status: 'Belum',
  tanggalSelesai: '',
});

const parseCurrencyValue = (value: unknown) => {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return Number(normalized) || 0;
};

const toSheetRow = (row: NewHutangRow) => [
  row.tanggal,
  row.akunDb,
  row.akunCr,
  parseCurrencyValue(row.nominal),
  row.keterangan,
  row.status || 'Belum',
  row.tanggalSelesai,
];

export function HutangOperasional() {
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedUnitKerja, setSelectedUnitKerja] = useState<any>(null);
  const [selectedBank, setSelectedBank] = useState<any>(null);
  const [selectedStatus, setSelectedStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rawData, setRawData] = useState<HutangRecord[]>([]);
  const [unitKerjaOptions, setUnitKerjaOptions] = useState<any[]>([]);
  const [bankOptions, setBankOptions] = useState<any[]>([]);
  const [statusOptions, setStatusOptions] = useState<any[]>(defaultStatusOptions);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeValue>(25);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editData, setEditData] = useState<HutangRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isBulkDelete, setIsBulkDelete] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newRows, setNewRows] = useState<NewHutangRow[]>(() => Array.from({ length: 10 }, createBlankRow));
  const [isAdding, setIsAdding] = useState(false);
  const { addNotification } = useNotifications();

  const fetchData = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    try {
      const values = await googleSheetsService.readData(spreadsheetId, `${sheetName}!A2:G`);
      const mapped: HutangRecord[] = (values || []).map((v: any, index: number) => ({
        rowIndex: index + 2,
        tanggal: v[0] || '',
        akunDb: v[1] || '',
        akunCr: v[2] || '',
        nominal: parseCurrencyValue(v[3]),
        keterangan: v[4] || '',
        status: v[5] || 'Belum',
        tanggalSelesai: v[6] || '',
      }));

      setRawData(mapped);
      setUnitKerjaOptions(Array.from(new Set(mapped.map(item => item.akunCr))).filter(Boolean).sort().map(value => ({ value, label: value })));
      setBankOptions(Array.from(new Set(mapped.map(item => item.akunDb))).filter(Boolean).sort().map(value => ({ value, label: value })));

      const sheetStatuses = Array.from(new Set(mapped.map(item => item.status || 'Belum'))).filter(Boolean);
      const mergedStatuses = Array.from(new Set([...defaultStatusOptions.map(item => item.value), ...sheetStatuses]));
      setStatusOptions(mergedStatuses.sort().map(value => ({ value, label: value })));
    } catch (error: any) {
      console.error('Error fetching hutang operasional:', error);
      toast.error(`Gagal memuat data: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredData = useMemo(() => {
    return rawData.filter(item => {
      const keyword = searchTerm.toLowerCase();
      const matchSearch =
        item.keterangan.toLowerCase().includes(keyword) ||
        item.akunCr.toLowerCase().includes(keyword) ||
        item.akunDb.toLowerCase().includes(keyword);
      const matchUnitKerja = !selectedUnitKerja || item.akunCr === selectedUnitKerja.value;
      const matchBank = !selectedBank || item.akunDb === selectedBank.value;
      const matchStatus = !selectedStatus || item.status === selectedStatus.value;

      let matchDate = true;
      if (startDate || endDate) {
        const itemDate = new Date(item.tanggal);
        if (startDate && itemDate < new Date(startDate)) matchDate = false;
        if (endDate && itemDate > new Date(endDate)) matchDate = false;
      }

      return matchSearch && matchUnitKerja && matchBank && matchStatus && matchDate;
    });
  }, [rawData, searchTerm, selectedUnitKerja, selectedBank, selectedStatus, startDate, endDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedUnitKerja, selectedBank, selectedStatus, startDate, endDate, itemsPerPage]);

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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setSelectedUnitKerja(null);
    setSelectedBank(null);
    setSelectedStatus(null);
    setSelectedRows([]);
    setCurrentPage(1);
    toast.success('Filter telah direset');
  };

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(filteredData.map(item => ({
      Tanggal: item.tanggal,
      'AKUN (Db)': item.akunDb,
      'AKUN (Cr)': item.akunCr,
      Nominal: item.nominal,
      Keterangan: item.keterangan,
      Status: item.status,
      'Tanggal Selesai': item.tanggalSelesai,
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Hutang Operasional');
    XLSX.writeFile(workbook, `Hutang_Operasional_${new Date().toISOString().split('T')[0]}.xlsx`);
    setIsExportOpen(false);
  };

  const exportToPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.text('Data Hutang Operasional Lain', 14, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Tanggal', 'AKUN (Db)', 'AKUN (Cr)', 'Nominal', 'Keterangan', 'Status', 'Tanggal Selesai']],
      body: filteredData.map(item => [
        item.tanggal,
        item.akunDb,
        item.akunCr,
        formatCurrency(item.nominal),
        item.keterangan,
        item.status,
        item.tanggalSelesai || '-',
      ]),
      styles: { fontSize: 8 },
    });
    doc.save(`Hutang_Operasional_${new Date().toISOString().split('T')[0]}.pdf`);
    setIsExportOpen(false);
  };

  const handleEdit = (item: HutangRecord) => {
    setEditingRow(item.rowIndex);
    setEditData({ ...item });
  };

  const handleCancel = () => {
    setEditingRow(null);
    setEditData(null);
  };

  const handleSave = async () => {
    if (!editData) return;

    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsSaving(true);
    try {
      await googleSheetsService.updateData(spreadsheetId, `${sheetName}!A${editData.rowIndex}:G${editData.rowIndex}`, [[
        editData.tanggal,
        editData.akunDb,
        editData.akunCr,
        editData.nominal,
        editData.keterangan,
        editData.status,
        editData.tanggalSelesai,
      ]]);

      setRawData(prev => prev.map(item => item.rowIndex === editData.rowIndex ? { ...editData } : item));
      setEditingRow(null);
      setEditData(null);
      toast.success('Data berhasil disimpan ke Google Sheets');
      addNotification('Berhasil simpan data', 'Data Hutang Operasional berhasil diperbarui di Google Sheets.', 'success');
    } catch (error: any) {
      console.error('Error saving hutang operasional:', error);
      toast.error(`Gagal menyimpan data: ${error.message}`);
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
    if (selectedRows.length === 0) {
      toast.error('Pilih data yang akan dihapus terlebih dahulu');
      return;
    }

    setIsBulkDelete(true);
    setRowToDelete(null);
    setIsConfirmOpen(true);
  };

  const handleDeleteRow = (rowIndex: number) => {
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

      toast.success(`${count} data berhasil dihapus dari Google Sheets`, { id: loadingToast });
      addNotification('Data berhasil dihapus', `${count} data Hutang Operasional berhasil dihapus dari sheet ${sheetName}.`, 'success');
      setSelectedRows([]);
      setRowToDelete(null);
      setIsConfirmOpen(false);
      await fetchData();
    } catch (error: any) {
      console.error('Error deleting hutang operasional:', error);
      toast.error(`Gagal menghapus data: ${error.message}`, { id: loadingToast });
    } finally {
      setIsLoading(false);
    }
  };

  const openAddModal = () => {
    setNewRows(Array.from({ length: 10 }, createBlankRow));
    setIsAddOpen(true);
  };

  const updateNewRow = (rowIndex: number, field: keyof NewHutangRow, value: string) => {
    setNewRows(prev => prev.map((row, index) => (
      index === rowIndex ? { ...row, [field]: value } : row
    )));
  };

  const handleAddPaste = (event: React.ClipboardEvent<HTMLInputElement | HTMLSelectElement>, rowIndex: number, field: keyof NewHutangRow) => {
    const pastedText = event.clipboardData.getData('text');
    if (!pastedText.includes('\t') && !pastedText.includes('\n')) return;

    event.preventDefault();
    const clipboardRows = pastedText.replace(/\r/g, '').split('\n').filter(row => row.trim() !== '');
    if (clipboardRows.length > 10) {
      toast.error('Maksimal 10 baris setiap kali paste');
    }

    const rows = clipboardRows.slice(0, 10).map(row => row.split('\t'));
    const startColumn = addRowFields.indexOf(field);

    setNewRows(prev => {
      const next = [...prev];
      while (next.length < rowIndex + rows.length) {
        next.push(createBlankRow());
      }

      rows.forEach((columns, rowOffset) => {
        const hasNoColumn = field === 'tanggal' && columns.length >= 8 && /^\d+$/.test((columns[0] || '').trim());
        const cells = hasNoColumn ? columns.slice(1) : columns;

        cells.forEach((cell, columnOffset) => {
          const targetField = addRowFields[startColumn + columnOffset];
          if (!targetField) return;

          const targetIndex = rowIndex + rowOffset;
          next[targetIndex] = {
            ...next[targetIndex],
            [targetField]: targetField === 'status' ? (cell.trim() || 'Belum') : cell.trim(),
          };
        });
      });

      return next;
    });
  };

  const addNewRow = () => {
    setNewRows(prev => [...prev, createBlankRow()]);
  };

  const handleAddSave = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    const filledRows = newRows.filter(row => (
      row.tanggal.trim() ||
      row.akunDb.trim() ||
      row.akunCr.trim() ||
      row.nominal.trim() ||
      row.keterangan.trim() ||
      row.tanggalSelesai.trim()
    ));

    if (filledRows.length === 0) {
      toast.error('Isi minimal satu baris data');
      return;
    }

    const invalidRowIndex = filledRows.findIndex(row => !row.tanggal || !row.akunDb || !row.akunCr || !row.nominal);
    if (invalidRowIndex !== -1) {
      toast.error(`Baris ${invalidRowIndex + 1} belum lengkap`);
      return;
    }

    setIsAdding(true);
    try {
      await googleSheetsService.appendData(spreadsheetId, `${sheetName}!A1`, filledRows.map(toSheetRow));
      toast.success(`${filledRows.length} data berhasil ditambahkan ke Google Sheets`);
      addNotification('Data berhasil ditambahkan', `${filledRows.length} data Hutang Operasional berhasil ditambahkan ke sheet ${sheetName}.`, 'success');
      setIsAddOpen(false);
      setNewRows(Array.from({ length: 10 }, createBlankRow));
      await fetchData();
    } catch (error: any) {
      console.error('Error adding hutang operasional:', error);
      toast.error(`Gagal menambah data: ${error.message}`);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex-shrink-0 border-b border-gray-100 p-3">
          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#009B4F]/10 text-[#009B4F]">
                <Landmark className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Hutang Operasional Lain</h1>
                <p className="text-xs text-gray-500">Monitoring data hutang operasional unit kerja</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedRows.length > 0 && (
                <button
                  onClick={handleBulkDelete}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-red-600/10 transition-all hover:bg-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Hapus ({selectedRows.length})
                </button>
              )}
              <button
                onClick={openAddModal}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-blue-600/10 transition-all hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Tambah Data
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsExportOpen(prev => !prev)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#009B4F] px-3 py-2 text-xs font-bold text-white shadow-md shadow-[#009B4F]/10 transition-all hover:bg-[#008543]"
                >
                  <Download className="h-4 w-4" />
                  Export Data
                </button>
                {isExportOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-2 shadow-xl">
                    <button
                      onClick={exportToExcel}
                      className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-emerald-50 hover:text-[#009B4F]"
                    >
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={exportToPDF}
                      className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-emerald-50 hover:text-[#009B4F]"
                    >
                      <FileText className="h-4 w-4 text-red-600" />
                      PDF (.pdf)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Cari keterangan, AKUN (Db), atau AKUN (Cr)..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-[36px] w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 text-xs outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetFilters}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
                title="Reset Filter"
              >
                <XCircle className="h-4 w-4" />
                Reset Filter
              </button>
              <button
                onClick={fetchData}
                className={`cursor-pointer rounded-lg bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-gray-100 ${isLoading ? 'animate-spin' : ''}`}
                title="Refresh Data"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <Select
              options={unitKerjaOptions}
              value={selectedUnitKerja}
              onChange={setSelectedUnitKerja}
              placeholder="Filter AKUN (Cr)..."
              isClearable
              isSearchable
              className="text-xs"
              styles={selectStyles}
              menuPortalTarget={document.body}
              menuPosition="fixed"
            />
            <Select
              options={bankOptions}
              value={selectedBank}
              onChange={setSelectedBank}
              placeholder="Filter AKUN (Db)..."
              isClearable
              isSearchable
              className="text-xs"
              styles={selectStyles}
              menuPortalTarget={document.body}
              menuPosition="fixed"
            />
            <Select
              options={statusOptions}
              value={selectedStatus}
              onChange={setSelectedStatus}
              placeholder="Filter Status..."
              isClearable
              isSearchable
              className="text-xs"
              styles={selectStyles}
              menuPortalTarget={document.body}
              menuPosition="fixed"
            />
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-[36px] w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
              title="Tanggal Mulai"
            />
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-[36px] w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
              title="Tanggal Akhir"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-gray-50/30">
          <table className="w-full min-w-[1200px] border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-[#004237] bg-[#005245]">
                <th className="w-12 border-r border-[#004237]/50 px-3 py-1.5 text-center text-[9px] font-black uppercase tracking-widest text-white">
                  <button onClick={toggleSelectAll} className="rounded p-1 transition-colors hover:bg-white/10">
                    {allPageRowsSelected ? <CheckSquare className="h-4 w-4 text-white" /> : <Square className="h-4 w-4 text-white" />}
                  </button>
                </th>
                <th className="w-12 border-r border-[#004237]/50 px-3 py-1.5 text-center text-[9px] font-black uppercase tracking-widest text-white">No</th>
                <th className="border-r border-[#004237]/50 px-4 py-1.5 text-left text-[9px] font-black uppercase tracking-widest text-white">Tanggal</th>
                <th className="border-r border-[#004237]/50 px-4 py-1.5 text-left text-[9px] font-black uppercase tracking-widest text-white">AKUN (Db)</th>
                <th className="border-r border-[#004237]/50 px-4 py-1.5 text-left text-[9px] font-black uppercase tracking-widest text-white">AKUN (Cr)</th>
                <th className="border-r border-[#004237]/50 px-4 py-1.5 text-right text-[9px] font-black uppercase tracking-widest text-white">Nominal</th>
                <th className="border-r border-[#004237]/50 px-4 py-1.5 text-left text-[9px] font-black uppercase tracking-widest text-white">Keterangan</th>
                <th className="border-r border-[#004237]/50 px-4 py-1.5 text-center text-[9px] font-black uppercase tracking-widest text-white">Status</th>
                <th className="border-r border-[#004237]/50 px-4 py-1.5 text-left text-[9px] font-black uppercase tracking-widest text-white">Tanggal Selesai</th>
                <th className="px-4 py-1.5 text-center text-[9px] font-black uppercase tracking-widest text-white">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
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
                    <tr
                      key={item.rowIndex}
                      className={`group transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40 ${isSelected ? 'bg-emerald-50' : ''}`}
                    >
                      <td className="border-r border-gray-50 px-3 py-0.5 text-center">
                        <button onClick={() => toggleSelectRow(item.rowIndex)} className="rounded p-1 transition-colors hover:bg-gray-100">
                          {isSelected ? <CheckSquare className="h-4 w-4 text-[#009B4F]" /> : <Square className="h-4 w-4 text-gray-300" />}
                        </button>
                      </td>
                      <td className="border-r border-gray-50 px-3 py-0.5 text-center font-mono text-[11px] text-gray-400">{rowNumber}</td>
                      <td className="whitespace-nowrap border-r border-gray-50 px-4 py-0.5 text-[11px] font-semibold text-gray-600">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editData?.tanggal || ''}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, tanggal: event.target.value } : null)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px] outline-none focus:border-[#009B4F]"
                          />
                        ) : item.tanggal}
                      </td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px] text-gray-800">
                        {isEditing ? (
                          <input
                            value={editData?.akunDb || ''}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, akunDb: event.target.value } : null)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px] outline-none focus:border-[#009B4F]"
                          />
                        ) : item.akunDb}
                      </td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-[11px] text-gray-800">
                        {isEditing ? (
                          <input
                            value={editData?.akunCr || ''}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, akunCr: event.target.value } : null)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px] outline-none focus:border-[#009B4F]"
                          />
                        ) : item.akunCr}
                      </td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-right font-mono text-[11px] font-black text-blue-600">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData?.nominal || 0}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, nominal: Number(event.target.value) || 0 } : null)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-right text-[11px] outline-none focus:border-[#009B4F]"
                          />
                        ) : formatCurrency(item.nominal)}
                      </td>
                      <td className="max-w-xs truncate border-r border-gray-50 px-4 py-0.5 text-[11px] font-medium text-gray-700 group-hover:whitespace-normal">
                        {isEditing ? (
                          <input
                            value={editData?.keterangan || ''}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, keterangan: event.target.value } : null)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px] outline-none focus:border-[#009B4F]"
                          />
                        ) : item.keterangan}
                      </td>
                      <td className="border-r border-gray-50 px-4 py-0.5 text-center">
                        {isEditing ? (
                          <select
                            value={editData?.status || 'Belum'}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, status: event.target.value } : null)}
                            className="h-7 rounded border border-gray-200 bg-white px-2 text-center text-[11px] font-bold outline-none focus:border-[#009B4F]"
                          >
                            {statusOptions.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest shadow-sm ${
                            item.status.toUpperCase() === 'SELESAI'
                              ? 'bg-emerald-100 text-emerald-700'
                              : item.status.toUpperCase() === 'HOLD'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                          }`}>
                            {item.status.toUpperCase() === 'SELESAI' ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                            {item.status}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap border-r border-gray-50 px-4 py-0.5 text-[11px] font-medium italic text-gray-500">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editData?.tanggalSelesai || ''}
                            onChange={(event) => setEditData(prev => prev ? { ...prev, tanggalSelesai: event.target.value } : null)}
                            className="h-7 w-full rounded border border-gray-200 px-2 text-[11px] outline-none focus:border-[#009B4F]"
                          />
                        ) : (item.tanggalSelesai || '-')}
                      </td>
                      <td className="px-4 py-0.5 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={handleSave}
                              disabled={isSaving}
                              className="rounded-lg bg-green-100 p-1.5 text-green-600 transition-colors hover:bg-green-200 disabled:opacity-50"
                              title="Simpan"
                            >
                              <Check className={`h-3.5 w-3.5 ${isSaving ? 'animate-pulse' : ''}`} />
                            </button>
                            <button
                              onClick={handleCancel}
                              disabled={isSaving}
                              className="rounded-lg bg-red-100 p-1.5 text-red-600 transition-colors hover:bg-red-200 disabled:opacity-50"
                              title="Batal"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleEdit(item)}
                              className="rounded-lg bg-blue-50 p-1.5 text-blue-600 transition-colors hover:bg-blue-100"
                              title="Edit Baris"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteRow(item.rowIndex)}
                              className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                              title="Hapus Data"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Search className="h-8 w-8 opacity-20" />
                      <p className="text-sm italic">Tidak ada data ditemukan</p>
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

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Show Data</span>
              <PageSizeDropdown options={pageSizeOptions} value={itemsPerPage} onChange={setItemsPerPage} className="w-16" />
            </div>

            {itemsPerPage !== 'all' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-1 px-2">
                  <span className="text-xs font-bold text-gray-900">{currentPage}</span>
                  <span className="text-xs text-gray-400">/</span>
                  <span className="text-xs text-gray-500">{totalPages}</span>
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isAddOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-black text-gray-800">Tambah Data Hutang Operasional Lain</h2>
              <button
                onClick={() => setIsAddOpen(false)}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                disabled={isAdding}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-gray-50/50 p-4">
              <table className="w-full min-w-[1100px] border-collapse bg-white text-[12px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#005245]">
                    <th className="w-12 border border-[#004237] px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white">No</th>
                    <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Tanggal</th>
                    <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">AKUN (Db)</th>
                    <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">AKUN (Cr)</th>
                    <th className="border border-[#004237] px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Nominal</th>
                    <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Keterangan</th>
                    <th className="border border-[#004237] px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white">Status</th>
                    <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Tanggal Selesai</th>
                  </tr>
                </thead>
                <tbody>
                  {newRows.map((row, index) => (
                    <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                      <td className="border border-gray-200 px-3 py-1 text-center font-mono text-[11px] text-gray-400">{index + 1}</td>
                      <td className="border border-gray-200 p-0">
                        <input
                          type="date"
                          value={row.tanggal}
                          onChange={(event) => updateNewRow(index, 'tanggal', event.target.value)}
                          onPaste={(event) => handleAddPaste(event, index, 'tanggal')}
                          className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                        />
                      </td>
                      <td className="border border-gray-200 p-0">
                        <input
                          value={row.akunDb}
                          onChange={(event) => updateNewRow(index, 'akunDb', event.target.value)}
                          onPaste={(event) => handleAddPaste(event, index, 'akunDb')}
                          className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                        />
                      </td>
                      <td className="border border-gray-200 p-0">
                        <input
                          value={row.akunCr}
                          onChange={(event) => updateNewRow(index, 'akunCr', event.target.value)}
                          onPaste={(event) => handleAddPaste(event, index, 'akunCr')}
                          className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                        />
                      </td>
                      <td className="border border-gray-200 p-0">
                        <input
                          value={row.nominal}
                          onChange={(event) => updateNewRow(index, 'nominal', event.target.value)}
                          onPaste={(event) => handleAddPaste(event, index, 'nominal')}
                          className="h-8 w-full border-0 px-2 text-right font-mono text-[11px] outline-none focus:bg-emerald-50"
                        />
                      </td>
                      <td className="border border-gray-200 p-0">
                        <input
                          value={row.keterangan}
                          onChange={(event) => updateNewRow(index, 'keterangan', event.target.value)}
                          onPaste={(event) => handleAddPaste(event, index, 'keterangan')}
                          className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                        />
                      </td>
                      <td className="border border-gray-200 p-0">
                        <select
                          value={row.status}
                          onChange={(event) => updateNewRow(index, 'status', event.target.value)}
                          onPaste={(event) => handleAddPaste(event, index, 'status')}
                          className="h-8 w-full border-0 bg-white px-2 text-center text-[11px] font-bold outline-none focus:bg-emerald-50"
                        >
                          {defaultStatusOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="border border-gray-200 p-0">
                        <input
                          type="date"
                          value={row.tanggalSelesai}
                          onChange={(event) => updateNewRow(index, 'tanggalSelesai', event.target.value)}
                          onPaste={(event) => handleAddPaste(event, index, 'tanggalSelesai')}
                          className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col justify-between gap-3 border-t border-gray-100 bg-white px-5 py-4 sm:flex-row sm:items-center">
              <button
                onClick={addNewRow}
                disabled={isAdding}
                className="flex w-fit items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Tambah Baris
              </button>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAddOpen(false)}
                  disabled={isAdding}
                  className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  onClick={handleAddSave}
                  disabled={isAdding}
                  className="rounded-lg bg-[#009B4F] px-5 py-2 text-xs font-bold text-white shadow-md shadow-[#009B4F]/10 transition-colors hover:bg-[#008543] disabled:opacity-50"
                >
                  {isAdding ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

const selectStyles = {
  control: (base: any) => ({
    ...base,
    minHeight: '36px',
    height: '36px',
    borderRadius: '0.5rem',
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    boxShadow: 'none',
    fontSize: '0.75rem',
    '&:hover': {
      borderColor: '#009B4F',
    },
  }),
  valueContainer: (base: any) => ({
    ...base,
    height: '34px',
    padding: '0 8px',
  }),
  indicatorsContainer: (base: any) => ({
    ...base,
    height: '34px',
  }),
  placeholder: (base: any) => ({ ...base, color: '#9ca3af' }),
  singleValue: (base: any) => ({ ...base, color: '#374151' }),
  menu: (base: any) => ({ ...base, zIndex: 80, borderRadius: '0.5rem', overflow: 'hidden' }),
  menuPortal: (base: any) => ({ ...base, zIndex: 140 }),
  option: (base: any, state: any) => ({
    ...base,
    fontSize: '0.75rem',
    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white',
    color: state.isSelected ? 'white' : '#374151',
    '&:active': {
      backgroundColor: '#009B4F',
    },
  }),
};
