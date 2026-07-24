import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Download, Calendar, RefreshCw, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, XCircle, Building, Edit2, Check, X, Trash2, CheckSquare, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import { googleSheetsService } from '../services/googleSheetsService';
import { norekService } from '../services/norekService';
import { useNotifications } from '../contexts/NotificationContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageSizeDropdown, type PageSizeValue } from '../components/PageSizeDropdown';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { canModifyDatabase, type RoleDatabasePermissionMap } from '../constants/databasePermissions';

interface MokerRecord {
  rowIndex?: number;
  tanggal: string;
  bank: string;
  cabang: string;
  dropping: number;
  pooling: number;
  net: number;
}

const selectStyles = {
  control: (base: any) => ({
    ...base,
    borderRadius: '0.5rem',
    minHeight: '38px',
    height: '38px',
    backgroundColor: 'white',
    borderColor: '#e5e7eb',
    fontSize: '0.875rem',
    fontWeight: '400',
    color: '#374151',
    '&:hover': {
      borderColor: '#009B4F'
    },
    boxShadow: 'none'
  }),
  placeholder: (base: any) => ({ ...base, color: '#9ca3af' }),
  singleValue: (base: any) => ({ ...base, color: '#374151' }),
  menu: (base: any) => ({ ...base, borderRadius: '0.5rem', overflow: 'hidden', zIndex: 50 }),
  option: (base: any, state: any) => ({
    ...base,
    fontSize: '0.875rem',
    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white',
    color: state.isSelected ? 'white' : '#374151',
    '&:active': {
      backgroundColor: '#009B4F'
    }
  })
};

interface DataMokerProps {
  currentUser?: any;
  roleDatabasePermissionMap?: RoleDatabasePermissionMap;
}

export function DataMoker({ currentUser, roleDatabasePermissionMap = {} }: DataMokerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCabang, setSelectedCabang] = useState<any>(null);
  const [selectedBank, setSelectedBank] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rawData, setRawData] = useState<MokerRecord[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<MokerRecord | null>(null);
  const [cabangOptions, setCabangOptions] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeValue>(25);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isBulkDelete, setIsBulkDelete] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);
  const { addNotification } = useNotifications();

  const canEditData = canModifyDatabase(currentUser?.role, 'data-moker', 'edit', roleDatabasePermissionMap);
  const canDeleteData = canModifyDatabase(currentUser?.role, 'data-moker', 'delete', roleDatabasePermissionMap);

  const bankOptions = [
    { value: 'BNI', label: 'BNI' },
    { value: 'BRI', label: 'BRI' },
    { value: 'BSI', label: 'BSI' }
  ];

  const pageSizeOptions: { value: PageSizeValue; label: string }[] = [
    { value: 25, label: '25' },
    { value: 50, label: '50' },
    { value: 100, label: '100' },
    { value: 'all', label: 'All' }
  ];

  const fetchData = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    try {
      // Fetch data from Google Sheets
      const values = await googleSheetsService.readData(spreadsheetId, 'RekapMoker!A2:F');
      if (values) {
        const mapped: MokerRecord[] = values.map((v: any, index: number) => ({
          rowIndex: index + 1, // index 0 (row 2) -> rowIndex 1 (for deleteRows)
          tanggal: v[0],
          bank: v[1],
          cabang: v[2],
          dropping: parseFloat(v[3]) || 0,
          pooling: parseFloat(v[4]) || 0,
          net: parseFloat(v[5]) || 0,
        }));
        setRawData(mapped);
      }

      // Fetch Cabang options from norek_mapping
      const mappings = await norekService.getAll();
      const uniqueCabang = Array.from(new Set(mappings.map(m => m.namaCabang)))
        .filter(Boolean)
        .sort((a, b) => (a || '').localeCompare(b || ''));
      
      setCabangOptions(uniqueCabang.map(c => ({ value: c, label: c })));
    } catch (error: any) {
      console.error('Error fetching data:', error);
      if (!error.message.includes('authorize')) {
        toast.error(`Gagal memuat data: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCabang, selectedBank, startDate, endDate, itemsPerPage]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
  };

  const filteredData = useMemo(() => {
    return rawData.filter(item => {
      const searchLower = searchTerm.toLowerCase();
      const matchSearch = !searchTerm || 
                         item.cabang.toLowerCase().includes(searchLower) ||
                         item.bank.toLowerCase().includes(searchLower) ||
                         item.tanggal.toLowerCase().includes(searchLower) ||
                         formatCurrency(item.dropping).toLowerCase().includes(searchLower) ||
                         formatCurrency(item.pooling).toLowerCase().includes(searchLower) ||
                         formatCurrency(item.net).toLowerCase().includes(searchLower);
      
      const matchCabang = !selectedCabang || item.cabang === selectedCabang.value;
      const matchBank = !selectedBank || item.bank === selectedBank.value;
      
      let matchDate = true;
      if (startDate || endDate) {
        const itemDate = new Date(item.tanggal);
        if (startDate && itemDate < new Date(startDate)) matchDate = false;
        if (endDate && itemDate > new Date(endDate)) matchDate = false;
      }

      return matchSearch && matchCabang && matchBank && matchDate;
    }).sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
  }, [rawData, searchTerm, selectedCabang, selectedBank, startDate, endDate]);

  const handleEdit = (index: number, item: MokerRecord) => {
    if (!canEditData) {
      toast.error('Anda tidak memiliki akses untuk mengedit Data Moker');
      return;
    }
    setEditingIndex(index);
    setEditForm({ ...item });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditForm(null);
  };

  const handleSave = async (index: number) => {
    if (!editForm || !editForm.rowIndex) return;
    if (!canEditData) {
      toast.error('Anda tidak memiliki akses untuk mengedit Data Moker');
      return;
    }

    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    setIsLoading(true);
    try {
      const updatedRow = [
        editForm.tanggal,
        editForm.bank,
        editForm.cabang,
        editForm.dropping,
        editForm.pooling,
        editForm.net
      ];

      await googleSheetsService.updateData(spreadsheetId, `RekapMoker!A${editForm.rowIndex + 1}:F${editForm.rowIndex + 1}`, [updatedRow]);
      
      const newRawData = [...rawData];
      const dataIndex = newRawData.findIndex(r => r.rowIndex === editForm.rowIndex);
      if (dataIndex !== -1) {
        newRawData[dataIndex] = editForm;
      }
      setRawData(newRawData);
      
      setEditingIndex(null);
      setEditForm(null);
      toast.success('Data berhasil diperbarui');
    } catch (error: any) {
      toast.error(`Gagal memperbarui data: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: keyof MokerRecord, value: any) => {
    if (!editForm) return;
    const updated = { ...editForm, [field]: value };
    
    if (field === 'dropping' || field === 'pooling') {
      const dropping = field === 'dropping' ? parseFloat(value) || 0 : editForm.dropping;
      const pooling = field === 'pooling' ? parseFloat(value) || 0 : editForm.pooling;
      updated.net = dropping - pooling;
    }
    
    setEditForm(updated);
  };

  const paginatedData = useMemo(() => {
    if (itemsPerPage === 'all') return filteredData;
    const startIndex = (currentPage - 1) * (itemsPerPage as number);
    return filteredData.slice(startIndex, startIndex + (itemsPerPage as number));
  }, [filteredData, currentPage, itemsPerPage]);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredData.length / (itemsPerPage as number));

  const resetFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setSelectedCabang(null);
    setSelectedBank(null);
    setCurrentPage(1);
    toast.success('Filter telah direset');
  };

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(filteredData.map(item => ({
      'Tanggal': item.tanggal,
      'Bank': item.bank,
      'Cabang': item.cabang,
      'Permintaan/Dropping': item.dropping,
      'Setoran/Pooling': item.pooling,
      'Net': item.net
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Moker');
    XLSX.writeFile(workbook, `Data_Moker_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Berhasil mengekspor ke Excel');
    setIsExportOpen(false);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text('Data Rekap Modal Kerja', 14, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Tanggal', 'Bank', 'Cabang', 'Dropping', 'Pooling', 'Net']],
      body: filteredData.map(item => [
        item.tanggal,
        item.bank,
        item.cabang,
        formatCurrency(item.dropping),
        formatCurrency(item.pooling),
        formatCurrency(item.net)
      ]),
    });
    doc.save(`Data_Moker_${new Date().toISOString().split('T')[0]}.pdf`);
    toast.success('Berhasil mengekspor ke PDF');
    setIsExportOpen(false);
  };

  const toggleSelectAll = () => {
    if (selectedRows.length === paginatedData.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(paginatedData.map(item => item.rowIndex!));
    }
  };

  const toggleSelectRow = (rowIndex: number) => {
    setSelectedRows(prev => 
      prev.includes(rowIndex) 
        ? prev.filter(id => id !== rowIndex) 
        : [...prev, rowIndex]
    );
  };

  const handleBulkDelete = () => {
    if (!canDeleteData) {
      toast.error('Anda tidak memiliki akses untuk menghapus Data Moker');
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
      toast.error('Anda tidak memiliki akses untuk menghapus Data Moker');
      return;
    }
    setRowToDelete(rowIndex);
    setIsBulkDelete(false);
    setIsConfirmOpen(true);
  };

  const confirmDelete = async () => {
    const count = isBulkDelete ? selectedRows.length : 1;
    const loadingToast = toast.loading(`Menghapus ${count} data...`);
    setIsLoading(true);
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    
    try {
      const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, 'RekapMoker');
      if (sheetId === null) {
        throw new Error('Sheet "RekapMoker" tidak ditemukan');
      }
      
      if (isBulkDelete) {
        await googleSheetsService.deleteRows(spreadsheetId, sheetId, selectedRows);
      } else if (rowToDelete !== null) {
        await googleSheetsService.deleteRow(spreadsheetId, sheetId, rowToDelete);
      }
      
      toast.success('Data berhasil dihapus', { id: loadingToast });
      addNotification(
        'Berhasil hapus data moker',
        `${count} data modal kerja berhasil dihapus.`,
        'success'
      );
      setIsConfirmOpen(false);
      setSelectedRows([]);
      setRowToDelete(null);
      await fetchData();
    } catch (error: any) {
      console.error('[Delete] Error details:', error);
      toast.error(`Gagal menghapus data: ${error.message || 'Terjadi kesalahan internal'}`, { id: loadingToast });
    } finally {
      setIsLoading(false);
      setIsBulkDelete(false);
      setRowToDelete(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-0">
        <div className="p-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#009B4F]/10 flex items-center justify-center text-[#009B4F]">
                <Building className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Data Modal Kerja</h1>
                <p className="text-xs text-gray-500">Rekapitulasi dropping dan pooling modal kerja harian Cabang</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <button 
                  onClick={() => setIsExportOpen(!isExportOpen)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#009B4F] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#008543]"
                >
                  <Download className="w-4 h-4" />
                  Export Data
                </button>
                {isExportOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in slide-in-from-top-2">
                    <button
                      onClick={exportToExcel}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-[#009B4F] transition-colors"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-green-600" />
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={exportToPDF}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-[#009B4F] transition-colors"
                    >
                      <FileText className="w-4 h-4 text-red-600" />
                      PDF (.pdf)
                    </button>
                  </div>
                )}
              </div>
              {selectedRows.length > 0 && canDeleteData && (
                <button 
                  onClick={handleBulkDelete}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all shadow-md shadow-red-600/10 text-xs font-bold cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  Hapus ({selectedRows.length})
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
              <input
                type="text"
                placeholder="Cari Keterangan..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 h-[38px] rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={resetFilters}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-xs font-bold cursor-pointer"
                title="Reset"
              >
                <XCircle className="w-4 h-4" />
                Reset
              </button>
              <button 
                onClick={fetchData}
                className={`p-2 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer ${isLoading ? 'animate-spin' : ''}`}
                title="Refresh Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Select
                options={cabangOptions}
                value={selectedCabang}
                onChange={setSelectedCabang}
                placeholder="Filter Cabang..."
                isClearable
                isSearchable
                className="text-xs"
                styles={selectStyles}
              />
            </div>
            <div className="relative">
              <Select
                options={bankOptions}
                value={selectedBank}
                onChange={setSelectedBank}
                placeholder="Filter Bank..."
                isClearable
                isSearchable={false}
                className="text-xs"
                styles={selectStyles}
              />
            </div>
            <div className="relative">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 h-[38px] rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-sm"
              />
            </div>
            <div className="relative">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 h-[38px] rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-sm"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto bg-gray-50/30 min-h-0">
          <table className="w-full text-[12px] border-collapse min-w-[1000px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#005245] border-b border-[#004237]">
                <th className="text-center py-1.5 px-3 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50 w-12">
                  {canDeleteData && (
                    <button onClick={toggleSelectAll} className="p-1 hover:bg-white/10 rounded transition-colors">
                      {selectedRows.length === paginatedData.length && paginatedData.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-white" />
                      ) : (
                        <Square className="w-4 h-4 text-white" />
                      )}
                    </button>
                  )}
                </th>
                <th className="text-center py-1.5 px-3 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50 w-12">No</th>
                <th className="text-left py-1.5 px-5 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Tanggal</th>
                <th className="text-left py-1.5 px-5 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Bank</th>
                <th className="text-left py-1.5 px-5 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Cabang</th>
                <th className="text-right py-1.5 px-5 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Dropping</th>
                <th className="text-right py-1.5 px-5 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Pooling</th>
                <th className="text-right py-1.5 px-5 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Net</th>
                <th className="text-center py-1.5 px-5 font-black text-white uppercase text-[9px] tracking-widest">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading && !editingIndex ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="w-8 h-8 border-4 border-[#009B4F]/20 border-t-[#009B4F] rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-gray-400 font-medium">Memuat data...</p>
                  </td>
                </tr>
              ) : paginatedData.length > 0 ? (
                paginatedData.map((item, i) => {
                  const rowNumber = itemsPerPage === 'all' ? i + 1 : (currentPage - 1) * (itemsPerPage as number) + i + 1;
                  const isEditing = editingIndex === i;
                  
                  let bankColor = 'bg-gray-100 text-gray-600';
                  if (item.bank === 'BRI') bankColor = 'bg-[#005fa6] text-white';
                  else if (item.bank === 'BNI') bankColor = 'bg-[#F45922] text-white';
                  else if (item.bank === 'BSI') bankColor = 'bg-[#0CA49D] text-white';

                  if (isEditing && editForm) {
                    return (
                      <tr key={`edit-${i}`} className="bg-emerald-50/50">
                        <td className="py-2 px-4 text-center text-gray-400 font-mono text-xs border-r border-gray-100">
                        <div className="w-4 h-4 mx-auto" />
                      </td>
                      <td className="py-2 px-4 text-center text-gray-400 font-mono text-xs border-r border-gray-100">{rowNumber}</td>
                        <td className="py-2 px-4 border-r border-gray-100">
                          <input
                            type="date"
                            value={editForm.tanggal}
                            onChange={(e) => handleInputChange('tanggal', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#009B4F] outline-none"
                          />
                        </td>
                        <td className="py-2 px-4 border-r border-gray-100">
                          <Select
                            options={bankOptions}
                            value={bankOptions.find(opt => opt.value === editForm.bank)}
                            onChange={(opt: any) => handleInputChange('bank', opt.value)}
                            className="text-xs"
                            styles={selectStyles}
                            isSearchable
                            placeholder="Pilih Bank..."
                          />
                        </td>
                        <td className="py-2 px-4 border-r border-gray-100">
                          <Select
                            options={cabangOptions}
                            value={cabangOptions.find(opt => opt.value === editForm.cabang)}
                            onChange={(opt: any) => handleInputChange('cabang', opt.value)}
                            className="text-xs"
                            styles={selectStyles}
                            isSearchable
                            placeholder="Pilih Cabang..."
                          />
                        </td>
                        <td className="py-2 px-4 border-r border-gray-100">
                          <input
                            type="number"
                            value={editForm.dropping}
                            onChange={(e) => handleInputChange('dropping', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#009B4F] outline-none text-right"
                          />
                        </td>
                        <td className="py-2 px-4 border-r border-gray-100">
                          <input
                            type="number"
                            value={editForm.pooling}
                            onChange={(e) => handleInputChange('pooling', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#009B4F] outline-none text-right"
                          />
                        </td>
                        <td className={`py-2 px-4 text-right font-mono font-black border-r border-gray-100 ${editForm.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(editForm.net)}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleSave(i)}
                              className="rounded-lg bg-green-100 p-1.5 text-green-600 transition-colors hover:bg-green-200"
                              title="Simpan"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={handleCancel}
                              className="rounded-lg bg-red-100 p-1.5 text-red-600 transition-colors hover:bg-red-200"
                              title="Batal"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={`${item.tanggal}-${item.bank}-${item.cabang}-${i}`} className={`transition-colors group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40 ${selectedRows.includes(item.rowIndex!) ? 'bg-emerald-50' : ''}`}>
                      <td className="py-0.5 px-3 text-center border-r border-gray-50">
                        {canDeleteData && (
                          <button 
                            onClick={() => toggleSelectRow(item.rowIndex!)}
                            className="p-1 hover:bg-gray-100 rounded transition-colors"
                          >
                            {selectedRows.includes(item.rowIndex!) ? (
                              <CheckSquare className="w-4 h-4 text-[#009B4F]" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-300" />
                            )}
                          </button>
                        )}
                      </td>
                      <td className="py-0.5 px-3 text-center text-gray-400 font-mono text-[11px] border-r border-gray-50">{rowNumber}</td>
                      <td className="py-0.5 px-5 text-gray-600 font-semibold border-r border-gray-50 whitespace-nowrap">{item.tanggal}</td>
                      <td className="py-0.5 px-5 border-r border-gray-50 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wider ${bankColor}`}>
                          {item.bank}
                        </span>
                      </td>
                      <td className="py-0.5 px-5 text-gray-800 font-bold border-r border-gray-50">{item.cabang}</td>
                      <td className="py-0.5 px-5 text-right font-mono text-green-600 font-black border-r border-gray-50 text-[11px]">{formatCurrency(item.dropping)}</td>
                      <td className="py-0.5 px-5 text-right font-mono text-red-600 font-black border-r border-gray-50 text-[11px]">{formatCurrency(item.pooling)}</td>
                      <td className={`py-0.5 px-5 text-right font-mono font-black border-r border-gray-50 text-[11px] ${item.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(item.net)}
                      </td>
                      <td className="py-0.5 px-5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {canEditData && (
                            <button
                              onClick={() => handleEdit(i, item)}
                              className="rounded-lg bg-blue-50 p-1.5 text-blue-600 transition-colors hover:bg-blue-100 cursor-pointer"
                              title="Edit Data"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDeleteData && (
                            <button
                              onClick={() => handleDeleteRow(item.rowIndex!)}
                              className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
                              title="Hapus Data"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Search className="w-8 h-8 opacity-20" />
                      <p className="text-sm italic">Tidak ada data ditemukan</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer with Pagination */}
        <div className="bg-white border-t border-gray-100 px-5 py-2 flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0">
          <div className="text-xs text-gray-500 font-medium">
            Menampilkan <span className="text-gray-900 font-bold">{paginatedData.length}</span> dari <span className="text-gray-900 font-bold">{filteredData.length}</span> baris data
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Show Data</span>
              <PageSizeDropdown
                options={pageSizeOptions}
                value={itemsPerPage}
                onChange={setItemsPerPage}
                className="w-16"
              />
            </div>

            {itemsPerPage !== 'all' && (
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1 px-2">
                  <span className="text-xs font-bold text-gray-900">{currentPage}</span>
                  <span className="text-xs text-gray-400">/</span>
                  <span className="text-xs text-gray-500">{totalPages}</span>
                </div>
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={isConfirmOpen}
        title={isBulkDelete ? "Konfirmasi Hapus Massal" : "Konfirmasi Hapus Data"}
        message={isBulkDelete 
          ? `Apakah Anda yakin ingin menghapus ${selectedRows.length} data terpilih dari Google Sheets? Tindakan ini tidak dapat dibatalkan.`
          : "Apakah Anda yakin ingin menghapus data ini dari Google Sheets? Tindakan ini tidak dapat dibatalkan."
        }
        onConfirm={confirmDelete}
        onCancel={() => {
          setIsConfirmOpen(false);
          setIsBulkDelete(false);
          setRowToDelete(null);
        }}
        isLoading={isLoading}
      />
    </div>
  );
}
