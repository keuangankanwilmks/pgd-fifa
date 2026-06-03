import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Download, Filter, Search, Landmark, ArrowUpRight, ArrowDownRight, Minus, Loader2, RefreshCw, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, XCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import Select, { components } from 'react-select';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import googleSheetsService from '../services/googleSheetsService';
import { cabangService, Cabang } from '../services/cabangService';
import toast from 'react-hot-toast';
import { PageSizeDropdown, type PageSizeValue } from '../components/PageSizeDropdown';
import { saldoHarianService, type SaldoHarianRow } from '../services/saldoHarianService';

interface SummaryItem {
  bank: string;
  balanceSistem: number;
  balanceBank: number;
  selisih: number;
  status: string;
}

const pageSizeOptions: { value: PageSizeValue; label: string }[] = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 'all', label: 'All' }
];

// --- Helper Functions ---
const customSelectStyles = {
  control: (base: any, state: any) => ({
    ...base,
    borderRadius: '0.75rem',
    paddingLeft: '2rem',
    minHeight: '42px',
    backgroundColor: '#f9fafb',
    borderColor: state?.isFocused ? '#009B4F' : '#e5e7eb',
    fontSize: '0.75rem',
    fontWeight: '500',
    color: '#374151',
    '&:hover': {
      borderColor: '#009B4F'
    },
    boxShadow: 'none'
  }),
  placeholder: (base: any) => ({ ...base, color: '#9ca3af' }),
  singleValue: (base: any) => ({ ...base, color: '#374151' }),
  menu: (base: any) => ({ ...base, borderRadius: '0.75rem', overflow: 'hidden', zIndex: 9999 }),
  menuPortal: (base: any) => ({ ...base, zIndex: 9999 }),
  option: (base: any, state: any) => ({
    ...base,
    fontSize: '0.75rem',
    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white',
    color: state.isSelected ? 'white' : '#374151',
    '&:active': {
      backgroundColor: '#009B4F'
    }
  })
};

const parseSheetDate = (sheetDate: any) => {
  if (sheetDate === undefined || sheetDate === null || sheetDate === "") return "";
  
  // Handle Excel serial number
  if (typeof sheetDate === 'number') {
    // Excel dates are days since 1899-12-30
    const date = new Date(Math.round((sheetDate - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }
  
  // Handle string date
  let dateStr = String(sheetDate).trim();
  
  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  // Handle weird formats like 026-03-10 (missing first digit)
  if (/^\d{3}-\d{2}-\d{2}$/.test(dateStr)) {
    return '2' + dateStr; // Assume it's 2026-03-10
  }

  // Handle YY-MM-DD or DD-MM-YY or other variations
  // Try to clean up common separators
  dateStr = dateStr.replace(/[\/\.]/g, '-');

  // Try parsing with Date object
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  // If it's something like 10-03-2026
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    // Check if it's DD-MM-YYYY
    if (parts[0].length <= 2 && parts[1].length <= 2 && parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }

  return dateStr;
};

export function Report({ currentUser }: { currentUser?: any }) {
  const [activeSubTab, setActiveSubTab] = useState<'rekon' | 'moker' | 'saldo'>('rekon');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBank, setSelectedBank] = useState('Semua');
  const [selectedCabang, setSelectedCabang] = useState('Semua');
  const [selectedStatus, setSelectedStatus] = useState('Semua');
  const [summaryData, setSummaryData] = useState<SummaryItem[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showData, setShowData] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeValue>(25);

  // Column resizing state
  const [columnWidths, setColumnWidths] = useState({
    tanggal: 120,
    keterangan: 350,
    bank: 100,
    cabang: 180,
    sistem: 160,
    bankNominal: 160,
    status: 120
  });

  const handleResize = (column: keyof typeof columnWidths, width: number) => {
    setColumnWidths(prev => ({ ...prev, [column]: Math.max(width, 50) }));
  };

  const startResizing = (column: keyof typeof columnWidths, e: React.MouseEvent) => {
    const startX = e.pageX;
    const startWidth = columnWidths[column];

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = startWidth + (moveEvent.pageX - startX);
      handleResize(column, newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const fetchSummary = async () => {
    setIsLoading(true);
    try {
      const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
      if (!spreadsheetId) {
        toast.error('Spreadsheet ID belum dikonfigurasi');
        setIsLoading(false);
        return;
      }

      console.log('Fetching data from spreadsheet:', spreadsheetId);
      // Use UNFORMATTED_VALUE to get raw numbers for dates
      const data = await googleSheetsService.readData(spreadsheetId, 'RekonData!A2:K', 'UNFORMATTED_VALUE');
      console.log('Raw data received:', data?.length, 'rows');
      
      if (!data || data.length === 0) {
        setSummaryData([]);
        setAllTransactions([]);
        return;
      }

      // Normalize data: parse dates in first column
      const normalizedData = data.map((row: any, index: number) => {
        const newRow = [...row];
        const originalDate = row[0];
        newRow[0] = parseSheetDate(originalDate);
        if (index < 5) console.log(`Row ${index} date: ${originalDate} -> ${newRow[0]}`);
        return newRow;
      });

      setAllTransactions(normalizedData);
    } catch (error: any) {
      console.error('Error fetching summary:', error);
      // Show error if it's not a "not connected" error
      if (!error.message.includes('authorize')) {
        toast.error(`Gagal memuat data: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleTampilkanData = () => {
    if (!startDate || !endDate) {
      toast.error('Silakan isi rentang tanggal terlebih dahulu');
      return;
    }
    setShowData(true);
    fetchSummary();
  };

  useEffect(() => {
    // We don't fetch data on mount anymore, only after Tampilkan Data is clicked
  }, []); // Empty mount

  // Derived options
  const bankOptions = ['Semua', ...new Set(allTransactions.map(row => row[2]).filter(Boolean))].sort();
  const cabangOptions = ['Semua', ...new Set(allTransactions.map(row => row[3]).filter(Boolean))].sort();
  const statusOptions = ['Semua', ...new Set(allTransactions.map(row => row[7]).filter(Boolean))].sort();

  const bankSelectOptions = bankOptions.map(opt => ({ 
    value: opt, 
    label: opt === 'Semua' ? 'Semua Bank' : opt 
  }));

  const cabangSelectOptions = cabangOptions.map(opt => ({ 
    value: opt, 
    label: opt === 'Semua' ? 'Semua Cabang' : opt 
  }));
  
  const statusSelectOptions = statusOptions.map(opt => ({ 
    value: opt, 
    label: opt === 'Semua' ? 'Semua Status' : opt 
  }));

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((row: any) => {
      const rowDate = row[0];
      const matchesStartDate = !startDate || rowDate >= startDate;
      const matchesEndDate = !endDate || rowDate <= endDate;
      const matchesBank = selectedBank === 'Semua' || row[2] === selectedBank;
      const matchesCabang = selectedCabang === 'Semua' || row[3] === selectedCabang;
      const matchesStatus = selectedStatus === 'Semua' || row[7] === selectedStatus;
      const matchesSearch = !searchQuery || 
                           row[1]?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           row[3]?.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesStartDate && matchesEndDate && matchesBank && matchesCabang && matchesStatus && matchesSearch;
    });
  }, [allTransactions, startDate, endDate, selectedBank, selectedCabang, selectedStatus, searchQuery]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate, selectedBank, selectedCabang, selectedStatus, searchQuery, itemsPerPage]);

  const paginatedTransactions = useMemo(() => {
    if (itemsPerPage === 'all') return filteredTransactions;
    const startIndex = (currentPage - 1) * (itemsPerPage as number);
    return filteredTransactions.slice(startIndex, startIndex + (itemsPerPage as number));
  }, [filteredTransactions, currentPage, itemsPerPage]);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredTransactions.length / (itemsPerPage as number));

  // Calculate summary based on filtered transactions
  useEffect(() => {
    const banks = ['BNI', 'BRI', 'BSI'];
    const summary = banks.map(bank => {
      const bankRows = filteredTransactions.filter((row: any) => {
        const rowBank = String(row[2] || '').trim().toUpperCase();
        return rowBank === bank;
      });
      const balanceSistem = bankRows.reduce((sum: number, row: any) => sum + (parseFloat(row[4]) || 0), 0);
      const balanceBank = bankRows.reduce((sum: number, row: any) => sum + (parseFloat(row[5]) || 0), 0);
      const selisih = balanceSistem - balanceBank;
      
      return {
        bank,
        balanceSistem,
        balanceBank,
        selisih,
        status: Math.abs(selisih) < 1 ? 'Cocok' : 'Selisih'
      };
    });

    setSummaryData(summary);
  }, [filteredTransactions]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
  };

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedBank('Semua');
    setSelectedCabang('Semua');
    setSelectedStatus('Semua');
    setSearchQuery('');
    setCurrentPage(1);
    setShowData(false);
    toast.success('Filter telah direset');
  };

  const exportToExcel = () => {
    if (filteredTransactions.length === 0) {
      toast.error('Tidak ada data untuk diekspor');
      return;
    }

    const dataToExport = filteredTransactions.map((row, index) => ({
      'No': index + 1,
      'Tanggal': row[0],
      'Keterangan': row[1],
      'Bank': row[2],
      'Cabang': row[3],
      'Nominal Sistem': parseFloat(row[4]) || 0,
      'Nominal Bank': parseFloat(row[5]) || 0,
      'Selisih': (parseFloat(row[4]) || 0) - (parseFloat(row[5]) || 0),
      'Status': row[7]
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Summary Rekon Bank');

    // Set column widths
    const wscols = [
      { wch: 5 },
      { wch: 15 },
      { wch: 40 },
      { wch: 10 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 15 }
    ];
    worksheet['!cols'] = wscols;

    XLSX.writeFile(workbook, `Summary_Rekon_Bank_${new Date().toISOString().split('T')[0]}.xlsx`);
    setIsExportOpen(false);
  };

  const exportToPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const today = new Date().toISOString().split('T')[0];
    
    doc.setFontSize(16);
    doc.text(`Laporan Rekonsiliasi - ${today}`, 14, 15);
    
    doc.setFontSize(10);
    doc.text(`Periode: ${startDate || '-'} s/d ${endDate || '-'}`, 14, 22);
    doc.text(`Cabang: ${selectedCabang}`, 14, 27);
    
    // Summary Table
    doc.setFontSize(12);
    doc.text('Summary Per Bank', 14, 35);
    
    const summaryRows = summaryData.map(data => [
      data.bank,
      formatCurrency(data.balanceSistem),
      formatCurrency(data.balanceBank),
      formatCurrency(data.selisih),
      data.status
    ]);

    autoTable(doc, {
      head: [['Bank', 'Balance Sistem', 'Balance Bank', 'Selisih', 'Status']],
      body: summaryRows,
      startY: 40,
      theme: 'grid',
      headStyles: { fillColor: [0, 155, 79] }
    });

    // Detail Table
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.text('Detail Transaksi', 14, finalY);

    const detailRows = filteredTransactions.map(row => [
      row[0],
      row[1],
      row[2],
      row[3],
      formatCurrency(parseFloat(row[4]) || 0),
      formatCurrency(parseFloat(row[5]) || 0),
      row[7]
    ]);

    autoTable(doc, {
      head: [['Tanggal', 'Keterangan', 'Bank', 'Cabang', 'Sistem', 'Bank', 'Status']],
      body: detailRows,
      startY: finalY + 5,
      theme: 'grid',
      styles: { fontSize: 7 },
      headStyles: { fillColor: [0, 82, 69] }
    });

    doc.save(`Laporan_Rekon_${today}.pdf`);
    toast.success('Laporan PDF berhasil diunduh');
    setIsExportOpen(false);
  };


  if (isLoading && activeSubTab === 'rekon') {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#009B4F] animate-spin" />
          <p className="text-sm text-gray-500">Memuat summary...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveSubTab('rekon')}
          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
            activeSubTab === 'rekon'
              ? 'bg-white text-[#009B4F] shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Summary Rekon Bank
        </button>
        <button
          onClick={() => setActiveSubTab('moker')}
          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
            activeSubTab === 'moker'
              ? 'bg-white text-[#009B4F] shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Summary Moker
        </button>
        <button
          onClick={() => setActiveSubTab('saldo')}
          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
            activeSubTab === 'saldo'
              ? 'bg-white text-[#009B4F] shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Saldo Bank Harian
        </button>
      </div>

      {activeSubTab === 'rekon' ? (
        <div className="space-y-4">
          <div className="flex bg-[#f9fafb]">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1 flex-1">
              <div>
                <h2 className="text-xl font-bold text-gray-800 tracking-tight">Summary Rekon Bank</h2>
                <p className="text-xs text-gray-500">Ringkasan hasil rekonsiliasi harian seluruh bank.</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 bg-white p-4 rounded-xl border border-gray-200 items-end">
              <div className="lg:col-span-2 space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Rentang Tanggal</label>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 h-[42px] focus-within:ring-2 focus-within:ring-[#009B4F]/20 focus-within:border-[#009B4F] transition-all">
                  <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setShowData(false);
                    }}
                    className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
                  />
                  <span className="text-gray-300">/</span>
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setShowData(false);
                    }}
                    className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
                  />
                </div>
              </div>

              <div className="space-y-2 relative">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Bank</label>
                <div className="relative">
                  <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
                  <Select
                    options={bankSelectOptions}
                    value={bankSelectOptions.find(opt => opt.value === selectedBank)}
                    onChange={(opt) => {
                      setSelectedBank(opt?.value || 'Semua');
                      setShowData(false);
                    }}
                    styles={customSelectStyles}
                    placeholder="Pilih Bank..."
                    isSearchable
                  />
                </div>
              </div>

              <div className="space-y-2 relative">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Cabang</label>
                <div className="relative">
                  <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
                  <Select
                    options={cabangSelectOptions}
                    value={cabangSelectOptions.find(opt => opt.value === selectedCabang)}
                    onChange={(opt) => {
                      setSelectedCabang(opt?.value || 'Semua');
                      setShowData(false);
                    }}
                    styles={customSelectStyles}
                    placeholder="Pilih Cabang..."
                    isSearchable
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Status</label>
                <div className="relative">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
                  <Select
                    options={statusSelectOptions}
                    value={statusSelectOptions.find(opt => opt.value === selectedStatus)}
                    onChange={(opt) => {
                      setSelectedStatus(opt?.value || 'Semua');
                      setShowData(false);
                    }}
                    styles={customSelectStyles}
                    placeholder="Pilih Status..."
                    isSearchable
                  />
                </div>
              </div>

              <div className="lg:col-span-2 space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Cari Transaksi</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Ketik keterangan atau cabang..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowData(false);
                    }}
                    className="w-full pl-10 pr-4 h-[42px] rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-xs shadow-sm font-medium text-gray-700"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button 
                onClick={resetFilters}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-xs font-bold cursor-pointer"
                title="Reset"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reset
              </button>
              {showData && (
                <button 
                  onClick={() => fetchSummary()}
                  className={`p-2 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer ${isLoading ? 'animate-spin' : ''}`}
                  title="Refresh Data"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
              {showData && (
                <div className="relative">
                  <button 
                    onClick={() => setIsExportOpen(!isExportOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-all shadow-md shadow-[#009B4F]/10 text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Export File
                  </button>
                  {isExportOpen && (
                    <div className="absolute left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50">
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
              )}
              <div className="flex-1" />
              <button
                onClick={handleTampilkanData}
                className="flex items-center justify-center gap-2 px-5 h-[38px] bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-all shadow-md text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Search className="w-4 h-4" />
                Tampilkan Data
              </button>
            </div>
          </div>

          {showData && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {summaryData.map((data) => (
              <div key={data.bank} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-[#009B4F]">
                      <Landmark className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-800">{data.bank}</h3>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    data.status === 'Cocok' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {data.status}
                  </span>
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Balance Sistem</span>
                    <span className="font-semibold text-gray-700">{formatCurrency(data.balanceSistem)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Balance Bank</span>
                    <span className="font-semibold text-gray-700">{formatCurrency(data.balanceBank)}</span>
                  </div>
                  <div className="pt-3 border-t border-gray-50 flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-800">Selisih</span>
                    <div className="flex items-center gap-1">
                      {data.selisih > 0 ? (
                        <ArrowUpRight className="w-4 h-4 text-red-500" />
                      ) : data.selisih < 0 ? (
                        <ArrowDownRight className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Landmark className="w-4 h-4 text-emerald-500 opacity-0" /> // Spacer
                      )}
                      <span className={`font-bold ${
                        data.selisih === 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {formatCurrency(Math.abs(data.selisih))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-800 text-base">Detail Transaksi Harian</h3>
            </div>
            <div className="overflow-x-auto max-h-[calc(100vh-340px)]">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-30">
                  <tr className="bg-[#005245] border-b border-[#004237]">
                    <th className="relative text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50 w-12">
                      No
                    </th>
                    <th className="relative text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50" style={{ width: columnWidths.tanggal }}>
                      Tanggal
                      <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#009B4F]/50 transition-colors" onMouseDown={(e) => startResizing('tanggal', e)} />
                    </th>
                    <th className="relative text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50" style={{ width: columnWidths.keterangan }}>
                      Keterangan
                      <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#009B4F]/50 transition-colors" onMouseDown={(e) => startResizing('keterangan', e)} />
                    </th>
                    <th className="relative text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50" style={{ width: columnWidths.bank }}>
                      Bank
                      <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#009B4F]/50 transition-colors" onMouseDown={(e) => startResizing('bank', e)} />
                    </th>
                    <th className="relative text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50" style={{ width: columnWidths.cabang }}>
                      Cabang
                      <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#009B4F]/50 transition-colors" onMouseDown={(e) => startResizing('cabang', e)} />
                    </th>
                    <th className="relative text-right py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50" style={{ width: columnWidths.sistem }}>
                      Nominal Sistem
                      <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#009B4F]/50 transition-colors" onMouseDown={(e) => startResizing('sistem', e)} />
                    </th>
                    <th className="relative text-right py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50" style={{ width: columnWidths.bankNominal }}>
                      Nominal Bank
                      <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#009B4F]/50 transition-colors" onMouseDown={(e) => startResizing('bankNominal', e)} />
                    </th>
                    <th className="relative text-center py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest" style={{ width: columnWidths.status }}>
                      Status
                      <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#009B4F]/50 transition-colors" onMouseDown={(e) => startResizing('status', e)} />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedTransactions.length > 0 ? (
                    paginatedTransactions.map((row, i) => {
                      const bankName = String(row[2] || '').trim().toUpperCase();
                      let bankColor = 'bg-gray-100 text-gray-600';
                      if (bankName === 'BRI') bankColor = 'bg-[#005fa6] text-white';
                      else if (bankName === 'BNI') bankColor = 'bg-[#F45922] text-white';
                      else if (bankName === 'BSI') bankColor = 'bg-[#0CA49D] text-white';

                      const rowNumber = itemsPerPage === 'all' ? i + 1 : (currentPage - 1) * (itemsPerPage as number) + i + 1;

                      return (
                        <tr key={i} className={`transition-colors group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40`}>
                          <td className="py-2 px-4 text-center text-gray-400 font-mono text-xs border-r border-gray-50">{rowNumber}</td>
                          <td className="py-2 px-6 text-gray-600 font-semibold border-r border-gray-50 text-[13px]">{row[0]}</td>
                          <td className="py-2 px-6 text-gray-800 font-bold max-w-md truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:bg-white group-hover:shadow-xl group-hover:z-10 group-hover:relative transition-all border-r border-gray-50 text-[13px]">{row[1]}</td>
                          <td className="py-2 px-6 border-r border-gray-50 text-[13px]">
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-wider shadow-sm ${bankColor}`}>
                              {row[2]}
                            </span>
                          </td>
                          <td className="py-2 px-6 text-gray-700 font-bold border-r border-gray-50 text-[13px]">{row[3]}</td>
                          <td className="py-2 px-6 text-right font-mono text-gray-900 font-black border-r border-gray-50 text-[13px]">{formatCurrency(parseFloat(row[4]) || 0)}</td>
                          <td className="py-2 px-6 text-right font-mono text-gray-900 font-black border-r border-gray-50 text-[13px]">{formatCurrency(parseFloat(row[5]) || 0)}</td>
                          <td className="py-2 px-6 text-center text-[13px]">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest shadow-sm ${
                              (row[7] === 'Cocok' || row[7] === 'Matched') ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                            }`}>
                              {row[7]?.toUpperCase() || 'UNKNOWN'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-20 text-center">
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

            {/* Footer with Pagination */}
            <div className="bg-white border-t border-gray-100 px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-gray-500 font-medium">
                Menampilkan <span className="text-gray-900 font-bold">{paginatedTransactions.length}</span> dari <span className="text-gray-900 font-bold">{filteredTransactions.length}</span> baris data
              </div>

              <div className="flex items-center gap-6">
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
          </div>
        )}
        </div>
      ) : activeSubTab === 'moker' ? (
        <SummaryMoker currentUser={currentUser} />
      ) : (
        <SaldoBankHarianReport />
      )}
    </div>
  );
}

function SummaryMoker({ currentUser }: { currentUser?: any }) {
  const [rawData, setRawData] = useState<any[]>([]);
  const [branches, setBranches] = useState<Cabang[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDates, setSelectedDates] = useState<any[]>([]);
  const [selectedArea, setSelectedArea] = useState<any[]>([]);
  const [selectedCabang, setSelectedCabang] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeValue>(25);
  const [showData, setShowData] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Custom components for Excel-like Select
  const CheckboxOption = (props: any) => {
    return (
      <components.Option {...props}>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.isSelected}
            onChange={() => null}
            className="w-4 h-4 rounded border-gray-300 text-[#009B4F] focus:ring-[#009B4F] cursor-pointer accent-[#009B4F]"
          />
          <span className={`text-xs ${props.isSelected ? 'font-bold text-[#009B4F]' : 'text-gray-700'}`}>
            {props.label}
          </span>
        </div>
      </components.Option>
    );
  };

  const MultiValueContainer = (props: any) => {
    const { index, getValue } = props;
    const total = getValue().length;
    if (index === 0) {
      return (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-[#009B4F] rounded-md border border-emerald-100">
          <span className="text-[10px] font-black uppercase tracking-tighter">{total} Terpilih</span>
        </div>
      );
    }
    return null;
  };

  const fetchData = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) return;

    setIsLoading(true);
    try {
      const [values, branchList] = await Promise.all([
        googleSheetsService.readData(spreadsheetId, 'RekapMoker!A2:F'),
        cabangService.getAll()
      ]);
      
      setBranches(branchList);

      if (values) {
        const mapped = values.map((v: any) => ({
          tanggal: v[0],
          bank: v[1],
          cabang: v[2],
          dropping: parseFloat(v[3]) || 0,
          pooling: parseFloat(v[4]) || 0,
          net: parseFloat(v[5]) || 0,
        }));
        setRawData(mapped);

      }
    } catch (error: any) {
      console.error('Error fetching moker data:', error);
      toast.error(`Gagal memuat data moker: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedDates([]);
    setSelectedArea([]);
    setSelectedCabang([]);
    setCurrentPage(1);
    setShowData(false);
    toast.success('Filter telah direset');
  };

  const handleSyncCabang = async () => {
    setIsLoading(true);
    try {
      await cabangService.seed();
      toast.success('Data cabang berhasil disinkronisasi ke Firestore');
      await fetchData();
    } catch (error) {
      console.error('Error syncing cabang:', error);
      toast.error('Gagal menyinkronkan data cabang');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleTampilkanData = () => {
    if (selectedDates.length === 0) {
      toast.error('Silakan pilih tanggal terlebih dahulu');
      return;
    }
    setShowData(true);
    fetchData();
  };

  const dateOptions = useMemo(() => {
    const unique = Array.from(new Set(rawData.map(item => item.tanggal))).sort((a, b) => (b || '').localeCompare(a || ''));
    return unique.map(d => ({ value: d, label: d }));
  }, [rawData]);

  const formatCurrency = (amount: number) => {
    const formatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Math.abs(amount));
    return amount < 0 ? `-${formatted}` : formatted;
  };

  const filteredData = useMemo(() => {
    // 1. Filter by selected dates
    const dateFiltered = selectedDates.length > 0 
      ? rawData.filter(item => selectedDates.some(d => d.value === item.tanggal))
      : rawData;

    // 2. Aggregate by branch (sum dropping, pooling, net)
    const groupedByBranch: Record<string, any> = {};
    dateFiltered.forEach(item => {
      if (!groupedByBranch[item.cabang]) {
        groupedByBranch[item.cabang] = {
          cabang: item.cabang,
          dropping: 0,
          pooling: 0,
          net: 0
        };
      }
      groupedByBranch[item.cabang].dropping += item.dropping;
      groupedByBranch[item.cabang].pooling += item.pooling;
      groupedByBranch[item.cabang].net += item.net;
    });

    // 3. Enrich with branch details (area, codes) and filter by search/selected branch
    const filteredGroups = Object.values(groupedByBranch).map(item => {
      const branchInfo = branches.find(b => b.nama === item.cabang);
      return {
        ...item,
        area: branchInfo?.area || 'LAINNYA',
        passionCode: branchInfo?.passionCode || '-',
        sapCode: branchInfo?.sapCode || '-'
      };
    }).filter(item => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm || 
        item.cabang.toLowerCase().includes(searchLower) ||
        item.area.toLowerCase().includes(searchLower) ||
        item.passionCode.toLowerCase().includes(searchLower) ||
        item.sapCode.toLowerCase().includes(searchLower) ||
        formatCurrency(item.dropping).toLowerCase().includes(searchLower) ||
        formatCurrency(item.pooling).toLowerCase().includes(searchLower) ||
        formatCurrency(item.net).toLowerCase().includes(searchLower);
      
      const matchesArea = selectedArea.length === 0 || 
        selectedArea.some(a => a.value === 'all') || 
        selectedArea.some(a => a.value === item.area);
      
      const matchesCabang = selectedCabang.length === 0 || 
        selectedCabang.some(c => c.value === 'all') || 
        selectedCabang.some(c => c.value === item.cabang);
      
      return matchesSearch && matchesArea && matchesCabang;
    });

    // 4. Re-build the grouped structure with subtotals
    const areaGroups: Record<string, any[]> = {};
    filteredGroups.forEach(item => {
      if (!areaGroups[item.area]) areaGroups[item.area] = [];
      areaGroups[item.area].push(item);
    });

    const sortedAreas = Object.keys(areaGroups).sort();
    const result: any[] = [];
    let branchCounter = 0;
    
    sortedAreas.forEach(area => {
      const areaItems = areaGroups[area].sort((a, b) => (a.cabang || '').localeCompare(b.cabang || ''));
      result.push({ isHeader: true, area });
      
      areaItems.forEach(item => {
        branchCounter++;
        result.push({ ...item, branchIndex: branchCounter });
      });
      
      const subtotal = areaItems.reduce((acc, curr) => ({
        dropping: acc.dropping + curr.dropping,
        pooling: acc.pooling + curr.pooling,
        net: acc.net + curr.net
      }), { dropping: 0, pooling: 0, net: 0 });
      
      result.push({ isSubtotal: true, area, ...subtotal });
    });

    return result;
  }, [rawData, branches, selectedDates, searchTerm, selectedArea, selectedCabang]);

  const grandTotal = useMemo(() => {
    return filteredData.reduce((acc, curr) => {
      if (curr.isHeader || curr.isSubtotal) return acc;
      return {
        dropping: acc.dropping + curr.dropping,
        pooling: acc.pooling + curr.pooling,
        net: acc.net + curr.net
      };
    }, { dropping: 0, pooling: 0, net: 0 });
  }, [filteredData]);

  const paginatedData = useMemo(() => {
    if (itemsPerPage === 'all') return filteredData;
    const startIndex = (currentPage - 1) * (itemsPerPage as number);
    return filteredData.slice(startIndex, startIndex + (itemsPerPage as number));
  }, [filteredData, currentPage, itemsPerPage]);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredData.length / (itemsPerPage as number));

  const exportToExcel = () => {
    const today = new Date().toISOString().split('T')[0];
    
    // Header rows to match UI
    const headerRow1 = ['No', 'KODE CABANG', '', 'CABANG', 'REKAP MOKER', '', ''];
    const headerRow2 = ['', 'PASSION', 'SAP', '', 'Dropping', 'Pooling', 'Net'];
    
    const dataRows = filteredData.flatMap((item) => {
      if (item.isHeader) return [[item.area, '', '', '', '', '', '']];
      if (item.isSubtotal) return [['', '', '', `TOTAL ${item.area}`, item.dropping, item.pooling, item.net]];
      return [[
        item.branchIndex,
        item.passionCode,
        item.sapCode,
        item.cabang,
        item.dropping,
        item.pooling,
        item.net
      ]];
    });

    const grandTotalRow = [['', '', '', 'TOTAL KANWIL VI MAKASSAR', grandTotal.dropping, grandTotal.pooling, grandTotal.net]];
    
    const aoa = [
      ['REKAPITULASI PERMINTAAN DAN SETORAN MODAL KERJA'],
      ['KANWIL VI MAKASSAR'],
      [`Tanggal : ${selectedDates.map(d => d.label).join(', ')}`],
      [],
      headerRow1,
      headerRow2,
      ...dataRows,
      ...grandTotalRow
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    
    // Add merges to match UI structure
    const lastRowIndex = aoa.length - 1;
    const merges: any[] = [
      // Title merges
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
      // Header merges
      { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } }, // No
      { s: { r: 4, c: 1 }, e: { r: 4, c: 2 } }, // Kode Cabang
      { s: { r: 4, c: 3 }, e: { r: 5, c: 3 } }, // Cabang
      { s: { r: 4, c: 4 }, e: { r: 4, c: 6 } }, // Rekap Moker
      // Grand Total merge
      { s: { r: lastRowIndex, c: 0 }, e: { r: lastRowIndex, c: 3 } }
    ];

    // Add merges for area headers and subtotals
    let currentRow = 6; // Data starts at row 6 (0-indexed)
    filteredData.forEach((item) => {
      if (item.isHeader) {
        merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 6 } });
      } else if (item.isSubtotal) {
        merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 3 } });
      }
      currentRow++;
    });

    worksheet['!merges'] = merges;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Summary Moker');
    XLSX.writeFile(workbook, `Summary_Moker_${today}.xlsx`);
    setIsExportOpen(false);
  };

  const exportToPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(14);
    doc.text('REKAPITULASI PERMINTAAN DAN SETORAN MODAL KERJA', 14, 15);
    doc.text('KANWIL VI MAKASSAR', 14, 22);
    doc.setFontSize(10);
    doc.text(`Tanggal : ${selectedDates.map(d => d.label).join(', ')}`, 14, 29);

    const body = filteredData.map((item) => {
      if (item.isHeader) return [{ content: item.area, colSpan: 7, styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'left' } }];
      if (item.isSubtotal) return [
        { content: `TOTAL ${item.area}`, colSpan: 4, styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'right' } },
        { content: formatCurrency(item.dropping), styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'right' } },
        { content: formatCurrency(item.pooling), styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'right' } },
        { content: formatCurrency(item.net), styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'right' } }
      ];
      return [
        { content: String(item.branchIndex), styles: { halign: 'center' } },
        { content: item.passionCode, styles: { halign: 'center' } },
        { content: item.sapCode, styles: { halign: 'center' } },
        { content: item.cabang, styles: { halign: 'left' } },
        { content: formatCurrency(item.dropping), styles: { halign: 'right' } },
        { content: formatCurrency(item.pooling), styles: { halign: 'right' } },
        { content: formatCurrency(item.net), styles: { halign: 'right' } }
      ];
    });

    // Add Grand Total
    body.push([
      { content: 'TOTAL KANWIL VI MAKASSAR', colSpan: 4, styles: { fillColor: [0, 82, 69], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' } as any },
      { content: formatCurrency(grandTotal.dropping), styles: { fillColor: [0, 82, 69], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' } as any },
      { content: formatCurrency(grandTotal.pooling), styles: { fillColor: [0, 82, 69], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' } as any },
      { content: formatCurrency(grandTotal.net), styles: { fillColor: [0, 82, 69], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' } as any }
    ]);

    autoTable(doc, {
      startY: 35,
      head: [
        [
          { content: 'No', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } }, 
          { content: 'KODE CABANG', colSpan: 2, styles: { halign: 'center' } }, 
          { content: 'CABANG', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } }, 
          { content: 'REKAP MOKER', colSpan: 3, styles: { halign: 'center' } }
        ],
        [
          { content: 'PASSION', styles: { halign: 'center' } }, 
          { content: 'SAP', styles: { halign: 'center' } }, 
          { content: 'Dropping', styles: { halign: 'center' } }, 
          { content: 'Pooling', styles: { halign: 'center' } }, 
          { content: 'NET', styles: { halign: 'center' } }
        ]
      ],
      body: body as any,
      theme: 'grid',
      headStyles: { fillColor: [0, 82, 69], textColor: [255, 255, 255] },
      styles: { fontSize: 8 }
    });

    doc.save(`Summary_Moker_${new Date().toISOString().split('T')[0]}.pdf`);
    setIsExportOpen(false);
  };

  const mokerBranchInfo = useMemo(() => {
    const uniqueBranches = Array.from(new Set(rawData.map(item => item.cabang)));
    return uniqueBranches.map(name => {
      const branchInfo = branches.find(b => b.nama === name);
      return {
        nama: name,
        area: branchInfo?.area || 'LAINNYA'
      };
    });
  }, [rawData, branches]);

  const areaOptions = useMemo(() => {
    const unique = Array.from(new Set(mokerBranchInfo.map(b => b.area))).sort();
    const options = unique.map(a => ({ value: a, label: a }));
    return [{ value: 'all', label: 'Pilih Semua' }, ...options];
  }, [mokerBranchInfo]);

  const cabangOptions = useMemo(() => {
    let filtered = mokerBranchInfo;
    if (selectedArea && selectedArea.length > 0) {
      const areaValues = selectedArea.map(a => a.value);
      if (!areaValues.includes('all')) {
        filtered = mokerBranchInfo.filter(b => areaValues.includes(b.area));
      }
    }
    const unique = Array.from(new Set(filtered.map(b => b.nama))).sort();
    const options = unique.map(c => ({ value: c, label: c }));
    return [{ value: 'all', label: 'Pilih Semua' }, ...options];
  }, [mokerBranchInfo, selectedArea]);

  // Default Select All on data load
  useEffect(() => {
    if (areaOptions.length > 1 && selectedArea.length === 0) {
      setSelectedArea(areaOptions);
    }
  }, [areaOptions]);

  useEffect(() => {
    if (cabangOptions.length > 1 && selectedCabang.length === 0) {
      setSelectedCabang(cabangOptions);
    }
  }, [cabangOptions]);

  const handleAreaChange = (selected: any) => {
    setShowData(false);
    if (!selected) {
      setSelectedArea([]);
      setSelectedCabang([]);
      return;
    }

    const lastSelected = selected[selected.length - 1];
    if (lastSelected?.value === 'all') {
      if (selected.length === areaOptions.length) {
        setSelectedArea([]);
        setSelectedCabang([]);
      } else {
        setSelectedArea(areaOptions);
      }
    } else {
      const filtered = selected.filter((item: any) => item.value !== 'all');
      if (filtered.length === areaOptions.length - 1) {
        setSelectedArea(areaOptions);
      } else {
        setSelectedArea(filtered);
      }
    }
  };

  const handleCabangChange = (selected: any) => {
    setShowData(false);
    if (!selected) {
      setSelectedCabang([]);
      return;
    }

    const lastSelected = selected[selected.length - 1];
    if (lastSelected?.value === 'all') {
      if (selected.length === cabangOptions.length) {
        setSelectedCabang([]);
      } else {
        setSelectedCabang(cabangOptions);
      }
    } else {
      const filtered = selected.filter((item: any) => item.value !== 'all');
      if (filtered.length === cabangOptions.length - 1) {
        setSelectedCabang(cabangOptions);
      } else {
        setSelectedCabang(filtered);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-visible">
        <div className="p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 tracking-tight">Summary Moker</h2>
              <p className="text-sm text-gray-500">Rekapitulasi dropping dan pooling modal kerja harian Cabang</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm items-end">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Cari Transaksi</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Ketik keterangan..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShowData(false);
                  }}
                  className="w-full pl-10 pr-4 h-[42px] rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-xs shadow-sm font-medium text-gray-700"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Area</label>
              <div className="relative">
                <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
                <Select
                  isMulti
                  options={areaOptions}
                  value={selectedArea}
                  onChange={handleAreaChange}
                  placeholder="Pilih Area..."
                  isClearable
                  isSearchable
                  hideSelectedOptions={false}
                  closeMenuOnSelect={false}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  components={{
                    Option: CheckboxOption,
                    MultiValue: MultiValueContainer
                  }}
                  styles={{
                    ...customSelectStyles,
                    control: (base, state) => ({
                      ...customSelectStyles.control(base, state),
                      paddingLeft: '32px'
                    }),
                    menu: (base) => ({ 
                      ...base, 
                      borderRadius: '1rem', 
                      overflow: 'hidden', 
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                      zIndex: 9999
                    }),
                    option: (base, state) => ({
                      ...base,
                      backgroundColor: state.isFocused ? '#f0fdf4' : 'transparent',
                      color: state.isSelected ? '#009B4F' : '#374151',
                      '&:active': { backgroundColor: '#dcfce7' }
                    })
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Cabang</label>
              <div className="relative">
                <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
                <Select
                  isMulti
                  options={cabangOptions}
                  value={selectedCabang}
                  onChange={handleCabangChange}
                  placeholder="Pilih Cabang..."
                  isClearable
                  isSearchable
                  hideSelectedOptions={false}
                  closeMenuOnSelect={false}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  components={{
                    Option: CheckboxOption,
                    MultiValue: MultiValueContainer
                  }}
                  styles={{
                    ...customSelectStyles,
                    control: (base, state) => ({
                      ...customSelectStyles.control(base, state),
                      paddingLeft: '32px'
                    }),
                    menu: (base) => ({ 
                      ...base, 
                      borderRadius: '1rem', 
                      overflow: 'hidden', 
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                      zIndex: 9999
                    }),
                    option: (base, state) => ({
                      ...base,
                      backgroundColor: state.isFocused ? '#f0fdf4' : 'transparent',
                      color: state.isSelected ? '#009B4F' : '#374151',
                      '&:active': { backgroundColor: '#dcfce7' }
                    })
                  }}
                />
              </div>
            </div>
            <div className="sm:col-span-2 space-y-2 relative">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Filter Tanggal</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
                <Select
                  isMulti
                  options={dateOptions}
                  value={selectedDates}
                  onChange={(val: any) => {
                    setSelectedDates(val || []);
                    setShowData(false);
                  }}
                  placeholder="Pilih Tanggal..."
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  styles={{
                    ...customSelectStyles,
                    control: (base, state) => ({
                      ...customSelectStyles.control(base, state),
                      paddingLeft: '32px'
                    }),
                    multiValue: (base) => ({ ...base, backgroundColor: '#f0fdf4', borderRadius: '0.5rem' }),
                    multiValueLabel: (base) => ({ ...base, color: '#009B4F', fontWeight: 'bold', fontSize: '10px' }),
                    multiValueRemove: (base) => ({ ...base, color: '#009B4F', '&:hover': { backgroundColor: '#009B4F', color: 'white' } })
                  }}
                />
              </div>
            </div>

          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={resetFilters}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-xs font-bold cursor-pointer"
              title="Reset"
            >
              <XCircle className="w-4 h-4" />
              Reset
            </button>
            {showData && (
              <button 
                onClick={fetchData}
                className={`p-2 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer ${isLoading ? 'animate-spin' : ''}`}
                title="Refresh Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            {showData && currentUser?.role !== 'guest' && (
              <button 
                onClick={handleSyncCabang}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-emerald-50 hover:text-[#009B4F] transition-colors text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                title="Sinkronisasi Data Cabang ke Firestore"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Sync Cabang
              </button>
            )}
            {showData && (
              <div className="relative z-50">
                <button 
                  onClick={() => setIsExportOpen(!isExportOpen)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-all shadow-md shadow-[#009B4F]/10 text-xs font-bold cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export File
                </button>
                {isExportOpen && (
                  <div className="absolute left-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-[100]">
                    <button
                      onClick={exportToExcel}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-emerald-50 hover:text-[#009B4F] transition-colors"
                    >
                      <FileSpreadsheet className="w-5 h-5 text-green-600" />
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={exportToPDF}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-emerald-50 hover:text-[#009B4F] transition-colors"
                    >
                      <FileText className="w-5 h-5 text-red-600" />
                      PDF (.pdf)
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="flex-1" />
            <button
              onClick={handleTampilkanData}
              className="flex items-center justify-center gap-2 px-5 h-[42px] bg-[#009B4F] text-white rounded-xl hover:bg-[#008543] transition-all shadow-md text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Search className="w-4 h-4" />
              Tampilkan Data
            </button>
          </div>
        </div>
      </div>

      {showData && (
          <div className="space-y-4">
            <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
            <table className="w-full text-sm border-collapse min-w-[1000px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#005245] border-b border-[#004237]">
                <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50 w-12">No</th>
                <th colSpan={2} className="text-center py-2 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Kode Cabang</th>
                <th rowSpan={2} className="text-center py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Cabang</th>
                <th colSpan={3} className="text-center py-2 px-6 font-black text-white uppercase text-[10px] tracking-widest">Rekap Moker</th>
              </tr>
              <tr className="bg-[#005245] border-b border-[#004237]">
                <th className="text-center py-2 px-4 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Passion</th>
                <th className="text-center py-2 px-4 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">SAP</th>
                <th className="text-center py-2 px-6 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Dropping</th>
                <th className="text-center py-2 px-6 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Pooling</th>
                <th className="text-center py-2 px-6 font-black text-white uppercase text-[9px] tracking-widest">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="w-8 h-8 border-4 border-[#009B4F]/20 border-t-[#009B4F] rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-gray-400 font-medium">Memuat data...</p>
                  </td>
                </tr>
              ) : paginatedData.length > 0 ? (
                paginatedData.map((item, i) => {
                  if (item.isHeader) {
                    return (
                      <tr key={`header-${item.area}`} className="bg-gray-100">
                        <td colSpan={7} className="py-2 px-4 font-black text-gray-800 uppercase text-xs tracking-widest">
                          {item.area}
                        </td>
                      </tr>
                    );
                  }
                  if (item.isSubtotal) {
                    return (
                      <tr key={`subtotal-${item.area}`} className="bg-gray-50 font-black">
                        <td colSpan={4} className="py-2 px-6 text-right text-gray-800 uppercase text-[10px] tracking-widest">
                          TOTAL {item.area}
                        </td>
                        <td className="py-2 px-6 text-right font-mono text-green-700 text-[13px]">{formatCurrency(item.dropping)}</td>
                        <td className="py-2 px-6 text-right font-mono text-red-700 text-[13px]">{formatCurrency(item.pooling)}</td>
                        <td className={`py-2 px-6 text-right font-mono text-[13px] ${item.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(item.net)}</td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={`${item.cabang}-${i}`} className={`transition-colors group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40`}>
                      <td className="py-2 px-4 text-center text-gray-400 font-mono text-xs border-r border-gray-50">{item.branchIndex}</td>
                      <td className="py-2 px-4 text-center text-gray-600 font-semibold border-r border-gray-50 text-[13px]">{item.passionCode}</td>
                      <td className="py-2 px-4 text-center text-gray-600 font-semibold border-r border-gray-50 text-[13px]">{item.sapCode}</td>
                      <td className="py-2 px-6 text-gray-800 font-bold border-r border-gray-50 text-[13px]">{item.cabang}</td>
                      <td className="py-2 px-6 text-right font-mono text-green-600 font-black border-r border-gray-50 text-[13px]">{formatCurrency(item.dropping)}</td>
                      <td className="py-2 px-6 text-right font-mono text-red-600 font-black border-r border-gray-50 text-[13px]">{formatCurrency(item.pooling)}</td>
                      <td className={`py-2 px-6 text-right font-mono font-black text-[13px] ${item.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(item.net)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Search className="w-8 h-8 opacity-20" />
                      <p className="text-sm italic">Tidak ada data ditemukan</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {!isLoading && filteredData.length > 0 && (
              <tfoot className="sticky bottom-0 z-20">
                <tr className="bg-[#005245] text-white font-black">
                  <td colSpan={4} className="py-2 px-6 text-right uppercase text-xs tracking-widest">
                    TOTAL KANWIL VI MAKASSAR
                  </td>
                  <td className="py-2 px-6 text-right font-mono text-[13px]">{formatCurrency(grandTotal.dropping)}</td>
                  <td className="py-2 px-6 text-right font-mono text-[13px]">{formatCurrency(grandTotal.pooling)}</td>
                  <td className="py-2 px-6 text-right font-mono text-[13px]">{formatCurrency(grandTotal.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="bg-white border-t border-gray-100 px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-gray-500 font-medium">
            Menampilkan <span className="text-gray-900 font-bold">{paginatedData.length}</span> dari <span className="text-gray-900 font-bold">{filteredData.length}</span> baris data
          </div>

            <div className="flex items-center gap-6">
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
        )}
      </div>
    );
}

function SaldoBankHarianReport() {
  const [chartStartDate, setChartStartDate] = useState('');
  const [chartEndDate, setChartEndDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rows, setRows] = useState<SaldoHarianRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showData, setShowData] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [chartTooltip, setChartTooltip] = useState<{
    bank: string;
    tanggal: string;
    value: number;
    x: number;
    y: number;
  } | null>(null);

  const formatCurrency = (amount: number) => (
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount)
  );

  const formatShortCurrency = (amount: number) => (
    new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(amount)
  );

  const formatDateLabel = (date: string) => {
    if (!date) return '-';
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  };

  const normalizeBankName = (bank: string) => String(bank || '').trim().toUpperCase();

  const getBankColor = (bank: string) => {
    const bankName = normalizeBankName(bank);
    const colorMap: Record<string, string> = {
      BNI: '#F45922',
      BRI: '#005FA6',
      BSI: '#0CA49D',
      BRIS: '#009B4F',
    };
    return colorMap[bankName] || '#64748b';
  };

  const fetchSaldoRows = async (showErrorToast = true) => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      if (showErrorToast) toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    try {
      const data = await saldoHarianService.readRows(spreadsheetId);
      setRows(data);
    } catch (error: any) {
      console.error('Saldo Bank Harian report error:', error);
      if (showErrorToast) {
        toast.error(`Gagal memuat Saldo Bank Harian: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSaldoRows(false);
  }, []);

  const handleTampilkanData = async () => {
    if (!startDate || !endDate) {
      toast.error('Silakan isi rentang tanggal terlebih dahulu');
      return;
    }

    await fetchSaldoRows();
    setShowData(true);
  };

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setShowData(false);
    setIsExportOpen(false);
    toast.success('Filter telah direset');
  };

  const resetChartFilters = () => {
    setChartStartDate('');
    setChartEndDate('');
  };

  const filteredRows = useMemo(() => {
    return rows
      .filter(item => {
        const tanggal = item.tanggal;
        return (!startDate || tanggal >= startDate) && (!endDate || tanggal <= endDate);
      })
      .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || '') || normalizeBankName(a.bank).localeCompare(normalizeBankName(b.bank)));
  }, [rows, startDate, endDate]);

  const groupedByDate = useMemo(() => {
    const grouped: Record<string, SaldoHarianRow[]> = {};
    filteredRows.forEach(item => {
      if (!grouped[item.tanggal]) grouped[item.tanggal] = [];
      grouped[item.tanggal].push(item);
    });

    return Object.keys(grouped)
      .sort()
      .map(tanggal => ({
        tanggal,
        rows: grouped[tanggal].sort((a, b) => normalizeBankName(a.bank).localeCompare(normalizeBankName(b.bank))),
      }));
  }, [filteredRows]);

  const chartRows = useMemo(() => (
    rows
      .filter(item => (
        item.tanggal &&
        item.bank &&
        (!chartStartDate || item.tanggal >= chartStartDate) &&
        (!chartEndDate || item.tanggal <= chartEndDate)
      ))
      .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || '') || normalizeBankName(a.bank).localeCompare(normalizeBankName(b.bank)))
  ), [rows, chartStartDate, chartEndDate]);

  const chartData = useMemo(() => {
    const dates = Array.from(new Set(chartRows.map(item => item.tanggal))).sort();
    const banks = Array.from(new Set(chartRows.map(item => normalizeBankName(item.bank)).filter(Boolean))).sort();
    return { dates, banks };
  }, [chartRows]);

  const exportToExcel = () => {
    if (filteredRows.length === 0) {
      toast.error('Tidak ada data untuk diekspor');
      return;
    }

    const dataToExport = filteredRows.map((item, index) => ({
      No: index + 1,
      Tanggal: formatDateLabel(item.tanggal),
      'No Rekening': item.noRekening,
      Bank: item.bank,
      'Nomor GL': item.nomorGL,
      'Saldo Sistem': item.saldoSistem,
      'Saldo Bank': item.saldoBank,
      Selisih: item.selisih,
      PIC: item.pic,
      Keterangan: item.keterangan,
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    worksheet['!cols'] = [
      { wch: 5 },
      { wch: 16 },
      { wch: 22 },
      { wch: 10 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 32 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Saldo Bank Harian');
    XLSX.writeFile(workbook, `Saldo_Bank_Harian_${startDate || 'awal'}_${endDate || 'akhir'}.xlsx`);
    toast.success('File Excel berhasil diunduh');
    setIsExportOpen(false);
  };

  const exportToPDF = () => {
    if (filteredRows.length === 0) {
      toast.error('Tidak ada data untuk diekspor');
      return;
    }

    const doc = new jsPDF('l', 'mm', 'a4');
    const today = new Date().toISOString().split('T')[0];

    doc.setFontSize(16);
    doc.text(`Laporan Saldo Bank Harian - ${today}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Periode: ${startDate || '-'} s/d ${endDate || '-'}`, 14, 22);

    autoTable(doc, {
      head: [['Tanggal', 'No Rekening', 'Bank', 'Nomor GL', 'Saldo Sistem', 'Saldo Bank', 'Selisih', 'PIC', 'Keterangan']],
      body: filteredRows.map(item => [
        formatDateLabel(item.tanggal),
        item.noRekening,
        item.bank,
        item.nomorGL,
        formatCurrency(item.saldoSistem),
        formatCurrency(item.saldoBank),
        formatCurrency(item.selisih),
        item.pic,
        item.keterangan,
      ]),
      startY: 30,
      theme: 'grid',
      styles: { fontSize: 7 },
      headStyles: { fillColor: [0, 82, 69] },
    });

    doc.save(`Saldo_Bank_Harian_${startDate || 'awal'}_${endDate || 'akhir'}.pdf`);
    toast.success('Laporan PDF berhasil diunduh');
    setIsExportOpen(false);
  };

  const renderLineChart = () => {
    const { dates, banks } = chartData;
    if (dates.length === 0 || banks.length === 0) {
      return (
        <div className="h-72 flex flex-col items-center justify-center text-gray-400">
          <Landmark className="w-10 h-10 opacity-20 mb-2" />
          <p className="text-sm italic">Belum ada data Saldo Bank Harian.</p>
        </div>
      );
    }

    const width = 980;
    const height = 320;
    const padding = { top: 34, right: 44, bottom: 60, left: 82 };
    const values = chartRows.map(item => item.saldoBank);
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(1, ...values);
    const span = maxValue - minValue || 1;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xFor = (index: number) => padding.left + (dates.length === 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth);
    const yFor = (value: number) => padding.top + plotHeight - ((value - minValue) / span) * plotHeight;
    const smoothPath = (points: { x: number; y: number }[]) => {
      if (points.length === 0) return '';
      if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

      return points.reduce((path, point, index) => {
        if (index === 0) return `M ${point.x} ${point.y}`;
        const previous = points[index - 1];
        const controlX = (previous.x + point.x) / 2;
        return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
      }, '');
    };

    return (
      <div className="relative overflow-x-auto rounded-xl bg-gradient-to-br from-white via-white to-emerald-50/50 px-2 pt-2">
        {chartTooltip && (
          <div
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[115%] rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-2xl"
            style={{
              left: `${Math.min(96, Math.max(8, (chartTooltip.x / width) * 100))}%`,
              top: `${Math.min(90, Math.max(14, (chartTooltip.y / height) * 100))}%`,
            }}
          >
            <div className="text-[10px] font-black uppercase tracking-widest text-[#009B4F]">{chartTooltip.bank}</div>
            <div className="text-xs font-semibold text-gray-500">{formatDateLabel(chartTooltip.tanggal)}</div>
            <div className="mt-1 text-sm font-black text-gray-900">{formatCurrency(chartTooltip.value)}</div>
          </div>
        )}

        <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[820px] w-full h-80">
          <defs>
            <filter id="saldo-line-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.16" />
            </filter>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const value = minValue + span * tick;
            const y = yFor(value);
            return (
              <g key={tick}>
                <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e5e7eb" strokeDasharray="4 4" />
                <text x={padding.left - 10} y={y + 4} textAnchor="end" className="fill-gray-400 text-[11px] font-semibold">
                  {formatShortCurrency(value)}
                </text>
              </g>
            );
          })}

          {dates.map((tanggal, index) => (
            <g key={tanggal}>
              <line x1={xFor(index)} y1={padding.top} x2={xFor(index)} y2={height - padding.bottom} stroke="#f3f4f6" />
              <text x={xFor(index)} y={height - 22} textAnchor="middle" className="fill-gray-500 text-[10px] font-bold">
                {formatDateLabel(tanggal).replace(' 2026', '')}
              </text>
            </g>
          ))}

          {banks.map((bankName, bankIndex) => {
            const bankRows = chartRows.filter(item => normalizeBankName(item.bank) === bankName);
            const bankColor = getBankColor(bankName);
            const points = bankRows.map(item => ({
              row: item,
              x: xFor(dates.indexOf(item.tanggal)),
              y: yFor(item.saldoBank),
            }));

            return (
              <g key={bankName}>
                <path
                  d={smoothPath(points)}
                  fill="none"
                  stroke={bankColor}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#saldo-line-shadow)"
                />
                {points.map(({ row, x, y }) => {
                  return (
                    <circle
                      key={`${bankName}-${row.tanggal}`}
                      cx={x}
                      cy={y}
                      r="5"
                      fill="white"
                      stroke={bankColor}
                      strokeWidth="3"
                      className="cursor-pointer transition-all hover:r-7"
                      onMouseEnter={() => setChartTooltip({ bank: row.bank, tanggal: row.tanggal, value: row.saldoBank, x, y })}
                      onMouseLeave={() => setChartTooltip(null)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        <div className="flex flex-wrap items-center gap-3 px-2 pb-2">
          {banks.map((bankName) => (
            <div key={bankName} className="flex items-center gap-2 text-xs font-bold text-gray-600">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: getBankColor(bankName) }} />
              {bankName}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex bg-[#f9fafb]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1 flex-1">
          <div>
            <h2 className="text-xl font-bold text-gray-800 tracking-tight">Saldo Bank Harian</h2>
            <p className="text-xs text-gray-500">Trend dan rekapitulasi saldo akhir bank harian dari sheet SaldoHarian.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
          <div>
            <h3 className="font-bold text-gray-800 text-xl tracking-tight">Trend Saldo Bank</h3>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-end gap-3">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Rentang Tanggal</label>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 h-[42px] focus-within:ring-2 focus-within:ring-[#009B4F]/20 focus-within:border-[#009B4F] transition-all">
                <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="date"
                  value={chartStartDate}
                  onChange={(event) => setChartStartDate(event.target.value)}
                  className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
                />
                <span className="text-gray-300">/</span>
                <input
                  type="date"
                  value={chartEndDate}
                  onChange={(event) => setChartEndDate(event.target.value)}
                  className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
                />
              </div>
            </div>
            <button
              onClick={resetChartFilters}
              className="flex h-[42px] items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-xs font-bold cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              onClick={() => fetchSaldoRows()}
              disabled={isLoading}
              className={`h-[42px] p-2 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait ${isLoading ? 'animate-spin' : ''}`}
              title="Refresh Chart"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-4">
          {isLoading && rows.length === 0 ? (
            <div className="h-72 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-[#009B4F] animate-spin" />
            </div>
          ) : renderLineChart()}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
        <h3 className="font-bold text-gray-800 text-base">Rekapitulasi Saldo Bank Harian</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-white p-4 rounded-xl border border-gray-200 items-end">
          <div className="md:col-span-2 space-y-2">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Rentang Tanggal</label>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 h-[42px] focus-within:ring-2 focus-within:ring-[#009B4F]/20 focus-within:border-[#009B4F] transition-all">
              <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setShowData(false);
                }}
                className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
              />
              <span className="text-gray-300">/</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setShowData(false);
                }}
                className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
              />
            </div>
          </div>

          <div className="md:col-span-3 flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={resetFilters}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-xs font-bold cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reset
            </button>
            {showData && (
              <button
                onClick={handleTampilkanData}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-emerald-50 hover:text-[#009B4F] transition-colors text-xs font-bold cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh Data
              </button>
            )}
            {showData && (
              <div className="relative">
                <button
                  onClick={() => setIsExportOpen(prev => !prev)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-all shadow-md shadow-[#009B4F]/10 text-xs font-bold cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export File
                </button>
                {isExportOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50">
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
            )}
            <button
              onClick={handleTampilkanData}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 px-5 h-[38px] bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-all shadow-md text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-wait"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Tampilkan Data
            </button>
          </div>
        </div>
      </div>

      {showData && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-360px)]">
              <table className="w-full text-sm border-collapse min-w-[1180px]">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#005245] border-b border-[#004237]">
                    <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Tanggal</th>
                    <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">No Rekening</th>
                    <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Bank</th>
                    <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Nomor GL</th>
                    <th colSpan={2} className="text-center py-2 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Saldo</th>
                    <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Selisih</th>
                    <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">PIC</th>
                    <th rowSpan={2} className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest">Keterangan</th>
                  </tr>
                  <tr className="bg-[#005245] border-b border-[#004237]">
                    <th className="text-center py-2 px-4 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Sistem</th>
                    <th className="text-center py-2 px-4 font-black text-white uppercase text-[9px] tracking-widest border-r border-[#004237]/50">Bank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {!isLoading && groupedByDate.length > 0 ? groupedByDate.map(group => (
                    group.rows.map((item, index) => (
                      <tr key={`${group.tanggal}-${item.bank}-${index}`} className={`transition-colors group ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40`}>
                        {index === 0 && (
                          <td rowSpan={group.rows.length} className="text-center py-2 px-4 font-black text-gray-800 border-r border-gray-50 align-middle text-[13px]">
                            {formatDateLabel(group.tanggal)}
                          </td>
                        )}
                        <td className="py-2 px-4 text-gray-600 border-r border-gray-50 font-mono text-[13px]">{item.noRekening}</td>
                        <td className="py-2 px-4 text-gray-800 border-r border-gray-50 font-bold text-[13px]">{item.bank}</td>
                        <td className="py-2 px-4 text-gray-600 border-r border-gray-50 font-mono text-[13px]">{item.nomorGL}</td>
                        <td className="py-2 px-4 text-right text-gray-900 border-r border-gray-50 font-mono font-black text-[13px]">{item.saldoSistem ? formatCurrency(item.saldoSistem) : ''}</td>
                        <td className="py-2 px-4 text-right text-gray-900 border-r border-gray-50 font-mono font-black text-[13px]">{item.saldoBank ? formatCurrency(item.saldoBank) : ''}</td>
                        <td className={`py-2 px-4 text-right border-r border-gray-50 font-mono font-black text-[13px] ${Math.abs(item.selisih) < 1 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(item.selisih)}</td>
                        <td className="py-2 px-4 text-gray-800 border-r border-gray-50 font-normal uppercase text-[13px]">{item.pic}</td>
                        <td className="py-2 px-4 text-gray-700 text-[13px]">{item.keterangan}</td>
                      </tr>
                    ))
                  )) : (
                    <tr>
                      <td colSpan={9} className="py-20 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <Search className="w-8 h-8 opacity-20" />
                          <p className="text-sm italic">Tidak ada data Saldo Harian pada rentang tanggal ini.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-white border-t border-gray-100 px-6 py-3 flex items-center justify-between">
              <div className="text-xs text-gray-500 font-medium">
                Menampilkan <span className="text-gray-900 font-bold">{filteredRows.length}</span> baris dari <span className="text-gray-900 font-bold">{groupedByDate.length}</span> tanggal.
              </div>
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Sumber: SaldoHarian
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
