import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, ChevronLeft, ChevronRight, Download, Edit2, FileSpreadsheet, FileText, RefreshCw, Search, X, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { googleSheetsService } from '../services/googleSheetsService';
import { PageSizeDropdown, type PageSizeValue } from '../components/PageSizeDropdown';

interface SaldoHarianRecord {
  rowIndex: number;
  tanggal: string;
  noRekening: string;
  bank: string;
  nomorGL: string;
  saldoBank: number;
  saldoSistem: number;
  selisih: number;
  pic: string;
  keterangan: string;
}

const sheetName = 'SaldoHarian';

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
  option: (base: any, state: any) => ({
    ...base,
    fontSize: '0.875rem',
    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white',
    color: state.isSelected ? 'white' : '#374151',
    '&:active': { backgroundColor: '#009B4F' },
  }),
};

const parseAmount = (value: any) => {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').replace(/[^0-9,-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function SaldoHarian() {
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBank, setSelectedBank] = useState<any>(null);
  const [selectedGL, setSelectedGL] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rawData, setRawData] = useState<SaldoHarianRecord[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SaldoHarianRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeValue>(25);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const pageSizeOptions: { value: PageSizeValue; label: string }[] = [
    { value: 25, label: '25' },
    { value: 50, label: '50' },
    { value: 100, label: '100' },
    { value: 'all', label: 'All' },
  ];

  const formatCurrency = (amount: number) => (
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount)
  );

  const fetchData = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    try {
      const values = await googleSheetsService.readData(spreadsheetId, `${sheetName}!A2:I`);
      const mapped: SaldoHarianRecord[] = (values || []).map((row: any[], index: number) => {
        const saldoBank = parseAmount(row[4]);
        const saldoSistem = parseAmount(row[5]);
        return {
          rowIndex: index + 2,
          tanggal: row[0] || '',
          noRekening: row[1] || '',
          bank: row[2] || '',
          nomorGL: row[3] || '',
          saldoBank,
          saldoSistem,
          selisih: row[6] === undefined || row[6] === '' ? saldoBank - saldoSistem : parseAmount(row[6]),
          pic: row[7] || '',
          keterangan: row[8] || '',
        };
      });
      setRawData(mapped);
    } catch (error: any) {
      console.error('Saldo Harian fetch error:', error);
      const message = String(error.message || '');
      if (message.includes('Unable to parse range') || message.includes('not found')) {
        setRawData([]);
      } else if (!message.includes('authorize')) {
        toast.error(`Gagal memuat Saldo Harian: ${message}`);
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
  }, [searchTerm, selectedBank, selectedGL, startDate, endDate, itemsPerPage]);

  const bankOptions = useMemo(() => (
    Array.from(new Set(rawData.map(item => item.bank).filter(Boolean)))
      .sort()
      .map(bank => ({ value: bank, label: bank }))
  ), [rawData]);

  const glOptions = useMemo(() => (
    Array.from(new Set(rawData.map(item => item.nomorGL).filter(Boolean)))
      .sort()
      .map(gl => ({ value: gl, label: gl }))
  ), [rawData]);

  const filteredData = useMemo(() => rawData.filter(item => {
    const searchLower = searchTerm.toLowerCase();
    const matchSearch = !searchTerm ||
      item.tanggal.toLowerCase().includes(searchLower) ||
      item.noRekening.toLowerCase().includes(searchLower) ||
      item.bank.toLowerCase().includes(searchLower) ||
      item.nomorGL.toLowerCase().includes(searchLower) ||
      item.pic.toLowerCase().includes(searchLower) ||
      item.keterangan.toLowerCase().includes(searchLower);

    const matchBank = !selectedBank || item.bank === selectedBank.value;
    const matchGL = !selectedGL || item.nomorGL === selectedGL.value;

    let matchDate = true;
    if (startDate || endDate) {
      const itemDate = new Date(item.tanggal);
      if (startDate && itemDate < new Date(startDate)) matchDate = false;
      if (endDate && itemDate > new Date(endDate)) matchDate = false;
    }

    return matchSearch && matchBank && matchGL && matchDate;
  }).sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '')), [rawData, searchTerm, selectedBank, selectedGL, startDate, endDate]);

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
    setSelectedBank(null);
    setSelectedGL(null);
    setCurrentPage(1);
    toast.success('Filter telah direset');
  };

  const handleEdit = (index: number, item: SaldoHarianRecord) => {
    setEditingIndex(index);
    setEditForm({ ...item });
  };

  const handleInputChange = (field: 'saldoBank' | 'saldoSistem' | 'keterangan', value: string) => {
    if (!editForm) return;
    const next = {
      ...editForm,
      [field]: field === 'keterangan' ? value : parseAmount(value),
    };
    next.selisih = next.saldoBank - next.saldoSistem;
    setEditForm(next);
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditForm(null);
  };

  const handleSave = async () => {
    if (!editForm) return;
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    setIsLoading(true);
    try {
      const rowValues = [[
        editForm.tanggal,
        editForm.noRekening,
        editForm.bank,
        editForm.nomorGL,
        editForm.saldoBank,
        editForm.saldoSistem,
        `=E${editForm.rowIndex}-F${editForm.rowIndex}`,
        editForm.pic,
        editForm.keterangan,
      ]];
      await googleSheetsService.updateData(spreadsheetId, `${sheetName}!A${editForm.rowIndex}:I${editForm.rowIndex}`, rowValues);
      setRawData(prev => prev.map(item => item.rowIndex === editForm.rowIndex ? editForm : item));
      setEditingIndex(null);
      setEditForm(null);
      toast.success('Saldo Harian berhasil diperbarui');
    } catch (error: any) {
      toast.error(`Gagal memperbarui Saldo Harian: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(filteredData.map(item => ({
      Tanggal: item.tanggal,
      'No Rekening': item.noRekening,
      Bank: item.bank,
      'Nomor GL': item.nomorGL,
      'Saldo Bank': item.saldoBank,
      'Saldo Sistem': item.saldoSistem,
      Selisih: item.selisih,
      PIC: item.pic,
      Keterangan: item.keterangan,
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Saldo Harian');
    XLSX.writeFile(workbook, `Saldo_Harian_${new Date().toISOString().split('T')[0]}.xlsx`);
    setIsExportOpen(false);
    toast.success('Berhasil mengekspor ke Excel');
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.text('Saldo Harian Rekonsiliasi Bank', 14, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Tanggal', 'No Rekening', 'Bank', 'Nomor GL', 'Saldo Bank', 'Saldo Sistem', 'Selisih', 'PIC', 'Keterangan']],
      body: filteredData.map(item => [
        item.tanggal,
        item.noRekening,
        item.bank,
        item.nomorGL,
        formatCurrency(item.saldoBank),
        formatCurrency(item.saldoSistem),
        formatCurrency(item.selisih),
        item.pic,
        item.keterangan,
      ]),
      styles: { fontSize: 7 },
    });
    doc.save(`Saldo_Harian_${new Date().toISOString().split('T')[0]}.pdf`);
    setIsExportOpen(false);
    toast.success('Berhasil mengekspor ke PDF');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex-shrink-0 border-b border-gray-100 p-3">
          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#009B4F]/10 text-[#009B4F]">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Saldo Harian</h1>
                <p className="text-xs text-gray-500">Rekapan saldo akhir bank dan sistem setiap hari</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
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
            </div>
          </div>

          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Cari Saldo Harian..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-[38px] w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={resetFilters} className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600">
                <XCircle className="h-4 w-4" />
                Reset Filter
              </button>
              <button onClick={fetchData} className={`cursor-pointer rounded-lg bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-gray-100 ${isLoading ? 'animate-spin' : ''}`}>
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Select options={bankOptions} value={selectedBank} onChange={setSelectedBank} placeholder="Filter Bank..." isClearable isSearchable={false} className="text-xs" styles={selectStyles} />
            <Select options={glOptions} value={selectedGL} onChange={setSelectedGL} placeholder="Filter Nomor GL..." isClearable isSearchable className="text-xs" styles={selectStyles} />
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-[38px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20" />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-[38px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition-all focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-gray-50/30">
          <table className="w-full min-w-[1300px] border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-[#004237] bg-[#005245]">
                {['No', 'Tanggal', 'No Rekening', 'Bank', 'Nomor GL', 'Saldo Bank', 'Saldo Sistem', 'Selisih', 'PIC', 'Keterangan', 'Aksi'].map(label => (
                  <th key={label} className={`border-r border-[#004237]/50 px-5 py-1.5 font-black uppercase tracking-widest text-white ${label === 'No' || label === 'Aksi' ? 'text-center' : label.includes('Saldo') || label === 'Selisih' ? 'text-right' : 'text-left'} text-[9px]`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading && rawData.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center">
                    <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-[#009B4F]/20 border-t-[#009B4F]" />
                    <p className="font-medium text-gray-400">Memuat data...</p>
                  </td>
                </tr>
              ) : paginatedData.length > 0 ? paginatedData.map((item, index) => {
                const rowNumber = itemsPerPage === 'all' ? index + 1 : (currentPage - 1) * (itemsPerPage as number) + index + 1;
                const isEditing = editingIndex === index;
                const form = isEditing ? editForm : null;
                const bankColor = item.bank === 'BRI' ? 'bg-[#005fa6] text-white' : item.bank === 'BNI' ? 'bg-[#F45922] text-white' : item.bank === 'BSI' ? 'bg-[#0CA49D] text-white' : 'bg-gray-100 text-gray-600';

                return (
                  <tr key={`${item.rowIndex}-${item.bank}-${item.tanggal}`} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} transition-colors hover:bg-emerald-50/40`}>
                    <td className="border-r border-gray-50 px-3 py-0.5 text-center font-mono text-[11px] text-gray-400">{rowNumber}</td>
                    <td className="whitespace-nowrap border-r border-gray-50 px-5 py-0.5 font-semibold text-gray-600">{item.tanggal}</td>
                    <td className="whitespace-nowrap border-r border-gray-50 px-5 py-0.5 font-mono text-[11px] text-gray-700">{item.noRekening || '-'}</td>
                    <td className="border-r border-gray-50 px-5 py-0.5">
                      <span className={`rounded px-2 py-0.5 text-[9px] font-black tracking-wider ${bankColor}`}>{item.bank}</span>
                    </td>
                    <td className="whitespace-nowrap border-r border-gray-50 px-5 py-0.5 font-bold text-gray-700">{item.nomorGL || '-'}</td>
                    <td className="border-r border-gray-50 px-5 py-0.5 text-right">
                      {form ? (
                        <input value={form.saldoBank} onChange={(event) => handleInputChange('saldoBank', event.target.value)} className="w-36 rounded border border-gray-200 px-2 py-1 text-right font-mono text-[11px] outline-none focus:border-[#009B4F]" />
                      ) : (
                        <span className="font-mono text-[11px] font-black text-gray-900">{formatCurrency(item.saldoBank)}</span>
                      )}
                    </td>
                    <td className="border-r border-gray-50 px-5 py-0.5 text-right">
                      {form ? (
                        <input value={form.saldoSistem} onChange={(event) => handleInputChange('saldoSistem', event.target.value)} className="w-36 rounded border border-gray-200 px-2 py-1 text-right font-mono text-[11px] outline-none focus:border-[#009B4F]" />
                      ) : (
                        <span className="font-mono text-[11px] font-black text-gray-900">{formatCurrency(item.saldoSistem)}</span>
                      )}
                    </td>
                    <td className={`border-r border-gray-50 px-5 py-0.5 text-right font-mono text-[11px] font-black ${(form?.selisih ?? item.selisih) === 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(form?.selisih ?? item.selisih)}</td>
                    <td className="whitespace-nowrap border-r border-gray-50 px-5 py-0.5 font-bold text-gray-700">{item.pic || '-'}</td>
                    <td className="border-r border-gray-50 px-5 py-0.5">
                      {form ? (
                        <input value={form.keterangan} onChange={(event) => handleInputChange('keterangan', event.target.value)} className="w-full min-w-56 rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-[#009B4F]" />
                      ) : (
                        <span className="text-[11px] font-medium text-gray-600">{item.keterangan || '-'}</span>
                      )}
                    </td>
                    <td className="px-5 py-0.5 text-center">
                      {form ? (
                        <div className="flex justify-center gap-1.5">
                          <button onClick={handleSave} className="rounded-lg bg-green-100 p-1.5 text-green-600 transition-colors hover:bg-green-200" title="Simpan">
                            <Check className="h-4 w-4" />
                          </button>
                          <button onClick={handleCancel} className="rounded-lg bg-red-100 p-1.5 text-red-600 transition-colors hover:bg-red-200" title="Batal">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => handleEdit(index, item)} className="rounded-lg px-2 py-1 text-emerald-600 transition-colors hover:bg-emerald-50" title="Edit Data">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={11} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Search className="h-8 w-8 opacity-20" />
                      <p className="text-sm italic">Tidak ada data Saldo Harian ditemukan</p>
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
    </div>
  );
}
