import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Download, RefreshCw, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, XCircle, Landmark, CheckCircle, AlertCircle, Edit2, Save, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import { googleSheetsService } from '../services/googleSheetsService';
import { norekService } from '../services/norekService';
import { useNotifications } from '../contexts/NotificationContext';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  const [statusOptions, setStatusOptions] = useState<any[]>([]);
  const [isGoogleConnected, setIsGoogleConnected] = useState(googleSheetsService.hasToken());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(25);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editData, setEditData] = useState<HutangRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { addNotification } = useNotifications();

  const handleConnectGoogle = async () => {
    try {
      await googleSheetsService.authorize();
      setIsGoogleConnected(true);
      toast.success('Terhubung ke Google Sheets');
      addNotification('Berhasil menghubungkan Google Sheets', 'Koneksi ke Google Sheets berhasil dilakukan.', 'success');
    } catch (error: any) {
      toast.error('Gagal menghubungkan Google Sheets');
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
      const values = await googleSheetsService.readData(spreadsheetId, 'HutOpr!A2:G');
      if (values) {
        const mapped: HutangRecord[] = values.map((v: any, index: number) => ({
          rowIndex: index + 2,
          tanggal: v[0] || '',
          akunDb: v[1] || '',
          akunCr: v[2] || '',
          nominal: parseFloat(v[3]) || 0,
          keterangan: v[4] || '',
          status: v[5] || '',
          tanggalSelesai: v[6] || '',
        }));
        setRawData(mapped);

        // Extract unique options
        const uniqueUnitKerja = Array.from(new Set(mapped.map(item => item.akunCr))).filter(Boolean).sort();
        setUnitKerjaOptions(uniqueUnitKerja.map(c => ({ value: c, label: c })));

        const uniqueBank = Array.from(new Set(mapped.map(item => item.akunDb))).filter(Boolean).sort();
        setBankOptions(uniqueBank.map(c => ({ value: c, label: c })));

        const uniqueStatus = Array.from(new Set(mapped.map(item => item.status))).filter(Boolean).sort();
        setStatusOptions(uniqueStatus.map(c => ({ value: c, label: c })));

        // Fetch Unit Kerja (Cabang) options from norek_mapping
        const mappings = await norekService.getAll();
        const uniqueCabang = Array.from(new Set(mappings.map(m => m.namaCabang)))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        
        setUnitKerjaOptions(uniqueCabang.map(c => ({ value: c, label: c })));
      }
    } catch (error: any) {
      console.error('Error fetching data:', error);
      if (!error.message.includes('authorize')) {
        toast.error(`Gagal memuat data: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editData) return;

    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    if (!isGoogleConnected) {
      toast.error('Silakan hubungkan Google Sheets terlebih dahulu');
      return;
    }

    setIsSaving(true);
    try {
      const values = [
        [
          editData.tanggal,
          editData.akunDb,
          editData.akunCr,
          editData.nominal.toString(),
          editData.keterangan,
          editData.status,
          editData.tanggalSelesai
        ]
      ];

      await googleSheetsService.updateData(spreadsheetId, `HutOpr!A${editData.rowIndex}:G${editData.rowIndex}`, values);
      
      const newData = [...rawData];
      const dataIndex = rawData.findIndex(r => r.rowIndex === editData.rowIndex);
      if (dataIndex !== -1) {
        newData[dataIndex] = { ...editData };
        setRawData(newData);
      }
      
      setEditingRow(null);
      setEditData(null);
      toast.success('Data berhasil disimpan ke Google Sheets');
      addNotification('Berhasil simpan data', 'Data Hutang Operasional berhasil diperbarui di Google Sheets.', 'success');
    } catch (error: any) {
      console.error('Error saving data:', error);
      toast.error(`Gagal menyimpan data: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingRow(null);
    setEditData(null);
  };

  const handleEdit = (index: number, item: HutangRecord) => {
    setEditingRow(index);
    setEditData({ ...item });
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (isGoogleConnected) fetchData();
  }, [isGoogleConnected]);

  const filteredData = useMemo(() => {
    return rawData.filter(item => {
      const matchSearch = item.keterangan.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         item.akunCr.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.akunDb.toLowerCase().includes(searchTerm.toLowerCase());
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

  const paginatedData = useMemo(() => {
    if (itemsPerPage === 'all') return filteredData;
    const startIndex = (currentPage - 1) * (itemsPerPage as number);
    return filteredData.slice(startIndex, startIndex + (itemsPerPage as number));
  }, [filteredData, currentPage, itemsPerPage]);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredData.length / (itemsPerPage as number));

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setSelectedUnitKerja(null);
    setSelectedBank(null);
    setSelectedStatus(null);
    setCurrentPage(1);
    toast.success('Filter telah direset');
  };

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(filteredData.map(item => ({
      'Tanggal': item.tanggal,
      'AKUN (Db)': item.akunDb,
      'AKUN (Cr)': item.akunCr,
      'Nominal': item.nominal,
      'Keterangan': item.keterangan,
      'Status': item.status,
      'Tanggal Selesai': item.tanggalSelesai
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
        item.tanggalSelesai
      ]),
      styles: { fontSize: 8 }
    });
    doc.save(`Hutang_Operasional_${new Date().toISOString().split('T')[0]}.pdf`);
    setIsExportOpen(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-1.5rem)] space-y-3">
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-0">
        <div className="p-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#009B4F]/10 flex items-center justify-center text-[#009B4F]">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Hutang Operasional Lain</h1>
                <p className="text-sm text-gray-500">Monitoring data hutang operasional unit kerja</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!isGoogleConnected ? (
                <button
                  onClick={handleConnectGoogle}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium shadow-sm cursor-pointer"
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
              <div className="relative">
                <button 
                  onClick={() => setIsExportOpen(!isExportOpen)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-xl hover:bg-[#008543] transition-all shadow-md shadow-[#009B4F]/10 text-xs font-bold cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export File
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
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
              <input
                type="text"
                placeholder="Cari keterangan atau unit kerja..."
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

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="relative">
              <Select
                options={unitKerjaOptions}
                value={selectedUnitKerja}
                onChange={setSelectedUnitKerja}
                placeholder="Filter Unit Kerja..."
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
                isSearchable
                className="text-xs"
                styles={selectStyles}
              />
            </div>
            <div className="relative">
              <Select
                options={statusOptions}
                value={selectedStatus}
                onChange={setSelectedStatus}
                placeholder="Filter Status..."
                isClearable
                isSearchable
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
                title="Tanggal Mulai"
              />
            </div>
            <div className="relative">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 h-[38px] rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all text-sm"
                title="Tanggal Akhir"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto bg-gray-50/30">
          <table className="w-full text-sm border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#005245] border-b border-[#004237]">
                <th className="text-center py-4 px-4 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50 w-12">No</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Tanggal</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">AKUN (Db)</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">AKUN (Cr)</th>
                <th className="text-right py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Nominal</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Keterangan</th>
                <th className="text-center py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Status</th>
                <th className="text-left py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest border-r border-[#004237]/50">Tanggal Selesai</th>
                <th className="text-center py-4 px-6 font-black text-white uppercase text-[10px] tracking-widest">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <div className="w-8 h-8 border-4 border-[#009B4F]/20 border-t-[#009B4F] rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-gray-400 font-medium">Memuat data...</p>
                  </td>
                </tr>
              ) : paginatedData.length > 0 ? (
                paginatedData.map((item, i) => {
                  const rowNumber = itemsPerPage === 'all' ? i + 1 : (currentPage - 1) * (itemsPerPage as number) + i + 1;
                  const isEditing = editingRow === i;
                  
                  return (
                    <tr key={`${item.tanggal}-${item.akunCr}-${i}`} className={`transition-colors group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40`}>
                      <td className="py-4 px-4 text-center text-gray-400 font-mono text-xs border-r border-gray-50">{rowNumber}</td>
                      <td className="py-4 px-6 text-gray-600 font-semibold border-r border-gray-50 whitespace-nowrap">
                        {isEditing ? (
                          <input 
                            type="date" 
                            value={editData?.tanggal} 
                            onChange={(e) => setEditData(prev => prev ? {...prev, tanggal: e.target.value} : null)}
                            className="w-full p-1 border rounded text-xs"
                          />
                        ) : item.tanggal}
                      </td>
                      <td className="py-4 px-6 text-gray-800 border-r border-gray-50">
                        {isEditing ? (
                          <Select
                            options={bankOptions}
                            value={bankOptions.find(opt => opt.value === editData?.akunDb)}
                            onChange={(opt: any) => setEditData(prev => prev ? {...prev, akunDb: opt.value} : null)}
                            className="text-xs"
                            styles={selectStyles}
                            isSearchable
                            placeholder="Pilih Bank..."
                          />
                        ) : item.akunDb}
                      </td>
                      <td className="py-4 px-6 text-gray-800 border-r border-gray-50">
                        {isEditing ? (
                          <Select
                            options={unitKerjaOptions}
                            value={unitKerjaOptions.find(opt => opt.value === editData?.akunCr)}
                            onChange={(opt: any) => setEditData(prev => prev ? {...prev, akunCr: opt.value} : null)}
                            placeholder="Pilih Unit Kerja..."
                            isSearchable
                            className="text-xs"
                            styles={selectStyles}
                          />
                        ) : item.akunCr}
                      </td>
                      <td className="py-4 px-6 text-right font-mono text-blue-600 font-black border-r border-gray-50">
                        {isEditing ? (
                          <input 
                            type="number" 
                            value={editData?.nominal} 
                            onChange={(e) => setEditData(prev => prev ? {...prev, nominal: parseFloat(e.target.value)} : null)}
                            className="w-full p-1 border rounded text-xs text-right"
                          />
                        ) : formatCurrency(item.nominal)}
                      </td>
                      <td className="py-4 px-6 text-gray-700 font-medium border-r border-gray-50 max-w-xs truncate group-hover:whitespace-normal">
                        {isEditing ? (
                          <textarea 
                            value={editData?.keterangan} 
                            onChange={(e) => setEditData(prev => prev ? {...prev, keterangan: e.target.value} : null)}
                            className="w-full p-1 border rounded text-xs"
                          />
                        ) : item.keterangan}
                      </td>
                      <td className="py-4 px-6 text-center border-r border-gray-50">
                        {isEditing ? (
                          <Select
                            options={[
                              { value: 'BELUM', label: 'BELUM' },
                              { value: 'HOLD', label: 'HOLD' },
                              { value: 'SELESAI', label: 'SELESAI' }
                            ]}
                            value={{ value: editData?.status, label: editData?.status }}
                            onChange={(opt: any) => setEditData(prev => prev ? {...prev, status: opt.value} : null)}
                            className="text-xs"
                            styles={selectStyles}
                          />
                        ) : (
                          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm ${
                            item.status.toUpperCase() === 'SELESAI' ? 'bg-emerald-100 text-emerald-700' : 
                            item.status.toUpperCase() === 'HOLD' ? 'bg-amber-100 text-amber-700' : 
                            'bg-red-100 text-red-700'
                          }`}>
                            {item.status.toUpperCase() === 'SELESAI' ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                            {item.status}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 text-gray-500 italic font-medium border-r border-gray-50">
                        {isEditing ? (
                          <input 
                            type="date" 
                            value={editData?.tanggalSelesai} 
                            onChange={(e) => setEditData(prev => prev ? {...prev, tanggalSelesai: e.target.value} : null)}
                            className="w-full p-1 border rounded text-xs"
                          />
                        ) : (item.tanggalSelesai || '-')}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-2">
                            <button 
                              onClick={handleSave}
                              disabled={isSaving}
                              className="p-1.5 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                              title="Simpan"
                            >
                              <Check className={`w-4 h-4 ${isSaving ? 'animate-pulse' : ''}`} />
                            </button>
                            <button 
                              onClick={handleCancel}
                              disabled={isSaving}
                              className="p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
                              title="Batal"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => handleEdit(i, item)}
                            className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                            title="Edit Baris"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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
    </div>
  );
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
