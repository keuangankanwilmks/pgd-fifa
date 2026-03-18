import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Download, Filter, Search, Landmark, ArrowUpRight, ArrowDownRight, Minus, Loader2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import Select from 'react-select';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import googleSheetsService from '../services/googleSheetsService';
import toast from 'react-hot-toast';

interface SummaryItem {
  bank: string;
  balanceSistem: number;
  balanceBank: number;
  selisih: number;
  status: string;
}

// --- Helper Functions ---
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

export function Report() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCabang, setSelectedCabang] = useState('Semua');
  const [selectedStatus, setSelectedStatus] = useState('Semua');
  const [summaryData, setSummaryData] = useState<SummaryItem[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGoogleConnected, setIsGoogleConnected] = useState(googleSheetsService.hasToken());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(25);

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

  const handleConnectGoogle = async () => {
    try {
      await googleSheetsService.authorize();
      setIsGoogleConnected(true);
      toast.success('Terhubung ke Google Sheets');
    } catch (error: any) {
      console.error('Auth error:', error);
      toast.error('Gagal menghubungkan Google Sheets');
    }
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

  useEffect(() => {
    fetchSummary();
  }, []); // Fetch data on mount regardless of connection status

  useEffect(() => {
    if (isGoogleConnected) {
      fetchSummary();
    }
  }, [isGoogleConnected]);

  // Derived options
  const cabangOptions = ['Semua', ...new Set(allTransactions.map(row => row[3]).filter(Boolean))].sort();
  const statusOptions = ['Semua', ...new Set(allTransactions.map(row => row[7]).filter(Boolean))].sort();

  const cabangSelectOptions = cabangOptions.map(opt => ({ 
    value: opt, 
    label: opt === 'Semua' ? 'Semua Cabang' : opt 
  }));
  
  const statusSelectOptions = statusOptions.map(opt => ({ 
    value: opt, 
    label: opt === 'Semua' ? 'Semua Status' : opt 
  }));

  const customSelectStyles = {
    control: (base: any) => ({
      ...base,
      borderRadius: '0.75rem',
      paddingLeft: '2rem',
      minHeight: '42px',
      backgroundColor: '#f9fafb',
      borderColor: '#e5e7eb',
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
    menu: (base: any) => ({ ...base, borderRadius: '0.75rem', overflow: 'hidden', zIndex: 50 }),
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

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((row: any) => {
      const rowDate = row[0];
      const matchesStartDate = !startDate || rowDate >= startDate;
      const matchesEndDate = !endDate || rowDate <= endDate;
      const matchesCabang = selectedCabang === 'Semua' || row[3] === selectedCabang;
      const matchesStatus = selectedStatus === 'Semua' || row[7] === selectedStatus;
      const matchesSearch = !searchQuery || 
                           row[1]?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           row[3]?.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesStartDate && matchesEndDate && matchesCabang && matchesStatus && matchesSearch;
    });
  }, [allTransactions, startDate, endDate, selectedCabang, selectedStatus, searchQuery]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate, selectedCabang, selectedStatus, searchQuery, itemsPerPage]);

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
  };


  if (isLoading) {
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
    <div className="space-y-3">
      <div className="bg-[#f9fafb]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1">
          <div>
            <h2 className="text-xl font-bold text-gray-800 tracking-tight">Summary Rekonsiliasi</h2>
            <p className="text-xs text-gray-500">Ringkasan hasil rekonsiliasi harian seluruh bank.</p>
          </div>
          {!isGoogleConnected && (
            <button 
              onClick={handleConnectGoogle}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-all text-xs font-bold shadow-sm cursor-pointer"
              title="Hubungkan untuk fitur Edit/Delete"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Hubungkan Google
            </button>
          )}
        </div>
      </div>

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
                    <Minus className="w-4 h-4 text-emerald-500" />
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
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <h3 className="font-bold text-gray-800 text-base">Detail Transaksi Harian</h3>
            <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={() => fetchSummary()}
                  className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-[#009B4F] bg-gray-50 border border-gray-200 rounded-xl transition-all cursor-pointer text-xs font-medium"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button 
                  onClick={exportToPDF}
                  className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-xl hover:bg-[#008543] transition-all shadow-md shadow-[#009B4F]/10 text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
              <div className="lg:col-span-2 space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Rentang Tanggal</label>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 h-[42px] focus-within:ring-2 focus-within:ring-[#009B4F]/20 focus-within:border-[#009B4F] transition-all">
                  <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
                  />
                  <span className="text-gray-300">/</span>
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="outline-none text-xs w-full bg-transparent font-medium text-gray-700"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Cabang</label>
                <div className="relative">
                  <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
                  <Select
                    options={cabangSelectOptions}
                    value={cabangSelectOptions.find(opt => opt.value === selectedCabang)}
                    onChange={(opt) => setSelectedCabang(opt?.value || 'Semua')}
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
                    onChange={(opt) => setSelectedStatus(opt?.value || 'Semua')}
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
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 h-[42px] rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-xs shadow-sm font-medium text-gray-700"
                  />
                </div>
              </div>
            </div>
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
                      <td className="py-4 px-4 text-center text-gray-400 font-mono text-xs border-r border-gray-50">{rowNumber}</td>
                      <td className="py-4 px-6 text-gray-600 font-semibold border-r border-gray-50">{row[0]}</td>
                      <td className="py-4 px-6 text-gray-800 font-bold max-w-md truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:bg-white group-hover:shadow-xl group-hover:z-10 group-hover:relative transition-all border-r border-gray-50">{row[1]}</td>
                      <td className="py-4 px-6 border-r border-gray-50">
                        <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider shadow-sm ${bankColor}`}>
                          {row[2]}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-gray-700 font-bold border-r border-gray-50">{row[3]}</td>
                      <td className="py-4 px-6 text-right font-mono text-gray-900 font-black border-r border-gray-50">{formatCurrency(parseFloat(row[4]) || 0)}</td>
                      <td className="py-4 px-6 text-right font-mono text-gray-900 font-black border-r border-gray-50">{formatCurrency(parseFloat(row[5]) || 0)}</td>
                      <td className="py-4 px-6 text-center">
                        <span className={`px-3 py-1.5 rounded-full text-[10px] font-black tracking-widest shadow-sm ${
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
    </div>
  );
}
