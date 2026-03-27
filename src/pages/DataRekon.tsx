import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Download, Edit2, Trash2, Calendar, Landmark, CheckCircle, AlertCircle, RefreshCw, Play, ChevronLeft, ChevronRight, XCircle, FileSpreadsheet, CheckSquare, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import * as XLSX from 'xlsx';
import { ConfirmModal } from '../components/ConfirmModal';
import { googleSheetsService } from '../services/googleSheetsService';
import { norekService } from '../services/norekService';
import { useNotifications } from '../contexts/NotificationContext';

import { User } from '../App';

interface DataRekonProps {
  bank: string;
  onUpdateRekon?: (bank: string, date: string, sistemData: any[], bankData: any[], rowIndices: number[]) => void;
  currentUser?: User | null;
}

export function DataRekon({ bank, onUpdateRekon, currentUser }: DataRekonProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCabang, setSelectedCabang] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [isBulkDelete, setIsBulkDelete] = useState(false);
  const [savedData, setSavedData] = useState<any[]>([]);
  const [cabangOptions, setCabangOptions] = useState<any[]>([]);

  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(googleSheetsService.hasToken());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(25);
  const { addNotification } = useNotifications();

  const handleConnectGoogle = async () => {
    try {
      await googleSheetsService.authorize();
      setIsGoogleConnected(true);
      toast.success('Terhubung ke Google Sheets');
      addNotification(
        'Berhasil menghubungkan Google Sheets',
        'Koneksi ke Google Sheets berhasil dilakukan.',
        'success'
      );
    } catch (error: any) {
      console.error('Auth error:', error);
      const errorMsg = error.error || error.message || 'Error tidak diketahui';
      if (errorMsg === 'popup_closed_by_user') {
        toast.error('Login dibatalkan');
      } else {
        toast.error(`Gagal menghubungkan Google Sheets: ${errorMsg}`);
      }
    }
  };

  const fetchData = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    try {
      const values = await googleSheetsService.readData(spreadsheetId, 'RekonData!A2:J');
      if (values) {
        const mapped = values.map((v: any, i: number) => ({
          id: String(i + 2), // Row index in Google Sheets
          tanggal: v[0],
          keterangan: v[1],
          bank: v[2],
          cabang: v[3],
          nominalSistem: parseFloat(v[4]) || 0,
          nominalBank: parseFloat(v[5]) || 0,
          selisih: parseFloat(v[6]) || 0,
          status: v[7],
          kategori: v[8] || '',
          catatan: v[9] || '',
          rowIndex: i + 1 // 0-based index for batchUpdate (A2 is index 1)
        }));
        
        setSavedData(mapped);

        // Extract unique branches for options
        const uniqueCabang = Array.from(new Set(mapped.map((item: any) => item.cabang))).filter(Boolean);
        setCabangOptions(uniqueCabang.map(c => ({ value: c, label: c })));
      }
    } catch (error: any) {
      console.error('Error fetching data:', error);
      // Show error if it's not a "not connected" error
      if (!error.message.includes('authorize')) {
        toast.error(`Gagal memuat data: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    return savedData.filter((item: any) => {
      const matchBank = item.bank === bank;
      const matchSearch = item.keterangan.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         item.catatan.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCabang = !selectedCabang || item.cabang === selectedCabang.value;
      
      let matchDate = true;
      if (startDate || endDate) {
        const itemDate = new Date(item.tanggal);
        if (startDate && itemDate < new Date(startDate)) matchDate = false;
        if (endDate && itemDate > new Date(endDate)) matchDate = false;
      }

      return matchBank && matchSearch && matchCabang && matchDate;
    });
  }, [savedData, bank, searchTerm, selectedCabang, startDate, endDate]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCabang, startDate, endDate, itemsPerPage]);

  const paginatedData = useMemo(() => {
    if (itemsPerPage === 'all') return filteredData;
    const startIndex = (currentPage - 1) * (itemsPerPage as number);
    return filteredData.slice(startIndex, startIndex + (itemsPerPage as number));
  }, [filteredData, currentPage, itemsPerPage]);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredData.length / (itemsPerPage as number));

  const uniqueDates = useMemo(() => {
    return Array.from(new Set(filteredData.map(item => item.tanggal)));
  }, [filteredData]);

  useEffect(() => {
    fetchData();
  }, []); // Fetch data on mount regardless of connection status

  useEffect(() => {
    if (isGoogleConnected) {
      fetchData();
    }
  }, [isGoogleConnected]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setSelectedCabang(null);
    setCurrentPage(1);
    toast.success('Filter telah direset');
  };

  const handleDeleteClick = (rowIndex: number) => {
    if (currentUser?.role !== 'admin') {
      toast.error('Hanya Administrator yang dapat menghapus data');
      return;
    }

    if (!isGoogleConnected) {
      toast.error('Silakan hubungkan Google Sheets terlebih dahulu');
      return;
    }

    setRowToDelete(rowIndex);
    setIsConfirmOpen(true);
  };

  const toggleSelectAll = () => {
    if (selectedRows.length === paginatedData.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(paginatedData.map(item => item.rowIndex));
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
    if (currentUser?.role !== 'admin') {
      toast.error('Hanya Administrator yang dapat menghapus data');
      return;
    }

    if (selectedRows.length === 0) {
      toast.error('Pilih data yang akan dihapus terlebih dahulu');
      return;
    }

    setIsBulkDelete(true);
    setIsConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!isBulkDelete && rowToDelete === null) return;
    if (isBulkDelete && selectedRows.length === 0) return;

    const loadingToast = toast.loading(isBulkDelete ? `Menghapus ${selectedRows.length} data...` : 'Menghapus data...');
    setIsLoading(true);
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi', { id: loadingToast });
      setIsLoading(false);
      setIsConfirmOpen(false);
      return;
    }

    try {
      const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, 'RekonData');
      if (sheetId === null) {
        throw new Error('Sheet "RekonData" tidak ditemukan');
      }
      
      if (isBulkDelete) {
        await googleSheetsService.deleteRows(spreadsheetId, sheetId, selectedRows);
      } else {
        await googleSheetsService.deleteRow(spreadsheetId, sheetId, rowToDelete!);
      }
      
      toast.success('Data berhasil dihapus', { id: loadingToast });
      addNotification(
        'Berhasil hapus data rekon',
        `Data rekonsiliasi Bank ${bank} berhasil dihapus.`,
        'success'
      );
      setIsConfirmOpen(false);
      setSelectedRows([]);
      await fetchData();
    } catch (error: any) {
      console.error('[Delete] Error details:', error);
      toast.error(`Gagal menghapus data: ${error.message || 'Terjadi kesalahan internal'}`, { id: loadingToast });
    } finally {
      setIsLoading(false);
      setRowToDelete(null);
      setIsBulkDelete(false);
    }
  };

  const exportToExcel = () => {
    if (filteredData.length === 0) {
      toast.error('Tidak ada data untuk diekspor');
      return;
    }

    const exportData = filteredData.map((item, index) => ({
      'No': index + 1,
      'Tanggal': item.tanggal,
      'Keterangan': item.keterangan,
      'Bank': item.bank,
      'Cabang': item.cabang,
      'Nominal Sistem': item.nominalSistem,
      'Nominal Bank': item.nominalBank,
      'Selisih': item.selisih,
      'Status': item.status,
      'Kategori': item.kategori,
      'Catatan': item.catatan
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Rekon');
    
    // Add column widths
    const wscols = [
      { wch: 5 }, { wch: 12 }, { wch: 40 }, { wch: 10 }, { wch: 20 },
      { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 30 }
    ];
    worksheet['!cols'] = wscols;

    XLSX.writeFile(workbook, `Data_Rekon_${bank}_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Berhasil mengekspor ke Excel');
  };

  const handleUpdateRekon = async () => {
    if (uniqueDates.length !== 1) {
      toast.error('Update Rekon hanya bisa dilakukan untuk satu tanggal saja. Silakan filter tanggal terlebih dahulu.');
      return;
    }

    if (!onUpdateRekon) return;

    const date = uniqueDates[0];
    
    // Split filteredData back to Sistem and Bank data
    const sistemData: any[] = [];
    const bankData: any[] = [];
    const rowIndices: number[] = [];

    filteredData.forEach((item, idx) => {
      rowIndices.push(item.rowIndex);
      
      if (item.status === 'Outstanding Sistem') {
        sistemData.push({
          id: `sys-update-${idx}`,
          tanggal: item.tanggal,
          keterangan: item.keterangan,
          nominalNormal: item.nominalSistem,
          cabang: item.cabang,
          kategori: item.kategori,
          catatan: item.catatan,
          debit: item.nominalSistem,
          kredit: 0,
          balance: 0
        });
      } else if (item.status === 'Belum Dibukukan') {
        bankData.push({
          id: `bnk-update-${idx}`,
          tanggal: item.tanggal,
          keterangan: item.keterangan,
          nominalNormal: item.nominalBank,
          cabang: item.cabang,
          kategori: item.kategori,
          catatan: item.catatan,
          amount: item.nominalBank,
          dc: item.nominalBank > 0 ? 'C' : 'D',
          balance: 0
        });
      }
    });

    onUpdateRekon(bank, date, sistemData, bankData, rowIndices);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-1.5rem)] space-y-3">
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-0">
        <div className="p-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#009B4F]/10 flex items-center justify-center text-[#009B4F]">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Database Rekon {bank}</h2>
                <p className="text-sm text-gray-500">Kelola hasil rekonsiliasi yang telah tersimpan.</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {!isGoogleConnected ? (
                <button 
                  onClick={handleConnectGoogle}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium shadow-sm cursor-pointer"
                  title="Hubungkan untuk fitur Edit/Delete"
                >
                  <RefreshCw className="w-4 h-4" />
                  Hubungkan Google
                </button>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100 text-xs font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Terhubung
                </div>
              )}
              <button 
                onClick={handleUpdateRekon}
                disabled={!isGoogleConnected || isLoading || uniqueDates.length !== 1}
                className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-colors text-sm font-bold shadow-sm cursor-pointer disabled:opacity-50"
                title={uniqueDates.length !== 1 ? "Filter satu tanggal untuk update rekon" : !isGoogleConnected ? "Hubungkan Google untuk Update Rekon" : ""}
              >
                <Play className="w-4 h-4" />
                Update Rekon
              </button>
              <button 
                onClick={exportToExcel}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-bold shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              {selectedRows.length > 0 && currentUser?.role === 'admin' && (
                <button 
                  onClick={handleBulkDelete}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-bold shadow-sm cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  Hapus ({selectedRows.length})
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
              <input 
                type="text" 
                placeholder="Cari keterangan..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 h-[38px] rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={resetFilters}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-xs font-bold cursor-pointer"
                title="Reset Filter"
              >
                <XCircle className="w-4 h-4" />
                Reset Filter
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Select
                options={cabangOptions}
                value={selectedCabang}
                onChange={setSelectedCabang}
                placeholder="Filter Cabang..."
                isClearable
                isSearchable
                className="text-xs"
                styles={{
                  control: (base) => ({
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
                  placeholder: (base) => ({ ...base, color: '#9ca3af' }),
                  singleValue: (base) => ({ ...base, color: '#374151' }),
                  menu: (base) => ({ ...base, borderRadius: '0.5rem', overflow: 'hidden', zIndex: 50 }),
                  option: (base, state) => ({
                    ...base,
                    fontSize: '0.875rem',
                    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white',
                    color: state.isSelected ? 'white' : '#374151',
                    '&:active': {
                      backgroundColor: '#009B4F'
                    }
                  })
                }}
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

        <div className="flex-1 overflow-auto bg-gray-50/30">
          <table className="w-full text-sm border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#005245] border-b border-[#004237]">
                <th className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50 w-12">
                  <button onClick={toggleSelectAll} className="p-1 hover:bg-white/10 rounded transition-colors">
                    {selectedRows.length === paginatedData.length && paginatedData.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-white" />
                    ) : (
                      <Square className="w-4 h-4 text-white" />
                    )}
                  </button>
                </th>
                <th className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50 w-12">No</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Tanggal</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Keterangan</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Bank</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Cabang</th>
                <th className="text-right py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Nominal Sistem</th>
                <th className="text-right py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Nominal Bank</th>
                <th className="text-right py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Selisih</th>
                <th className="text-center py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Status</th>
                <th className="text-center py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Kategori</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Catatan Rekon</th>
                <th className="text-center py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {paginatedData.length > 0 ? (
                paginatedData.map((item, i) => {
                  const bankName = String(item.bank || '').trim().toUpperCase();
                  let bankColor = 'bg-gray-100 text-gray-600';
                  if (bankName === 'BRI') bankColor = 'bg-[#005fa6] text-white';
                  else if (bankName === 'BNI') bankColor = 'bg-[#F45922] text-white';
                  else if (bankName === 'BSI') bankColor = 'bg-[#0CA49D] text-white';

                  const rowNumber = itemsPerPage === 'all' ? i + 1 : (currentPage - 1) * (itemsPerPage as number) + i + 1;

                  return (
                    <tr key={item.id} className={`transition-colors group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40 ${selectedRows.includes(item.rowIndex) ? 'bg-emerald-50' : ''}`}>
                      <td className="py-4 px-4 text-center border-r border-gray-50">
                        <button 
                          onClick={() => toggleSelectRow(item.rowIndex)}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                          {selectedRows.includes(item.rowIndex) ? (
                            <CheckSquare className="w-4 h-4 text-[#009B4F]" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-300" />
                          )}
                        </button>
                      </td>
                      <td className="py-4 px-4 text-center text-gray-400 font-mono text-xs border-r border-gray-50">{rowNumber}</td>
                      <td className="py-4 px-6 text-gray-600 font-semibold border-r border-gray-50 whitespace-nowrap">{item.tanggal}</td>
                      <td className="py-4 px-6 text-gray-800 font-bold max-w-md truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:bg-white group-hover:shadow-xl group-hover:z-10 group-hover:relative transition-all border-r border-gray-50">{item.keterangan}</td>
                      <td className="py-4 px-6 border-r border-gray-50">
                        <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider shadow-sm ${bankColor}`}>
                          {item.bank}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-gray-700 font-bold border-r border-gray-50">{item.cabang}</td>
                      <td className="py-4 px-6 text-right font-mono text-gray-900 font-black border-r border-gray-50">{formatCurrency(item.nominalSistem)}</td>
                      <td className="py-4 px-6 text-right font-mono text-gray-900 font-black border-r border-gray-50">{formatCurrency(item.nominalBank)}</td>
                      <td className="py-4 px-6 text-right font-mono text-gray-900 font-black border-r border-gray-50">{formatCurrency(item.selisih)}</td>
                      <td className="py-4 px-6 text-center border-r border-gray-50">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm ${
                          item.status === 'Matched' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                        }`}>
                          {item.status === 'Matched' ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                          {item.status}
                        </div>
                      </td>
                      <td className="py-4 px-6 border-r border-gray-50">
                        <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm ${item.kategori === 'Non Pembayaran' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {item.kategori}
                        </span>
                      </td>
                      <td className="py-4 px-6 border-r border-gray-50">
                        <span className="text-gray-500 font-medium italic">{item.catatan}</span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        {currentUser?.role === 'admin' && (
                          <button 
                            onClick={() => handleDeleteClick(item.rowIndex)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Hapus Data"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={13} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Search className="w-8 h-8 opacity-20" />
                      <p className="text-sm italic">Tidak ada data yang sesuai dengan filter.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white border-t border-gray-100 px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-4 flex-shrink-0">
          <div className="text-xs text-gray-500 font-medium">
            Menampilkan <span className="text-gray-900 font-bold">{paginatedData.length}</span> dari <span className="text-gray-900 font-bold">{filteredData.length}</span> baris data
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Show Data:</span>
              <select 
                value={itemsPerPage} 
                onChange={(e) => setItemsPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F]"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value="all">All</option>
              </select>
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

        {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={isConfirmOpen}
        title={isBulkDelete ? "Konfirmasi Hapus Massal" : "Konfirmasi Hapus"}
        message={isBulkDelete 
          ? `Apakah Anda yakin ingin menghapus ${selectedRows.length} data terpilih dari Google Sheets? Tindakan ini tidak dapat dibatalkan.`
          : "Apakah Anda yakin ingin menghapus data ini dari Google Sheets? Tindakan ini tidak dapat dibatalkan."
        }
        onConfirm={confirmDelete}
        onCancel={() => {
          setIsConfirmOpen(false);
          setRowToDelete(null);
          setIsBulkDelete(false);
        }}
        isLoading={isLoading}
      />
    </div>
  );
}
