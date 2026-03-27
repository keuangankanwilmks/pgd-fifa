import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight, Save, X, Database, RefreshCw, Play } from 'lucide-react';
import * as XLSX from 'xlsx';
import Select from 'react-select';
import toast from 'react-hot-toast';
import { googleSheetsService } from '../services/googleSheetsService';
import { useNotifications } from '../contexts/NotificationContext';
import { cabangService } from '../services/cabangService';
import { norekService, NoRekMapping } from '../services/norekService';

interface MokerData {
  id: string;
  tanggal: string;
  keterangan: string;
  nominal: number;
  cabang: string;
  bank: string;
  type: 'dropping' | 'pooling';
}

const parseExcelDate = (excelDate: any) => {
  if (!excelDate) return "";
  
  let numericDate = NaN;
  if (typeof excelDate === 'number') {
    numericDate = excelDate;
  } else if (typeof excelDate === 'string') {
    const trimmed = excelDate.trim();
    if (trimmed === "") return "";
    if (!isNaN(Number(trimmed)) && trimmed.includes('.')) {
      numericDate = parseFloat(trimmed);
    } else if (!isNaN(Number(trimmed)) && trimmed.length > 4) {
      // Likely an Excel serial date as a string
      numericDate = parseFloat(trimmed);
    }
  }

  if (!isNaN(numericDate)) {
    const date = new Date(Math.round((numericDate - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }

  if (excelDate instanceof Date) {
    return excelDate.toISOString().split('T')[0];
  }
  
  const str = String(excelDate).trim();
  if (str === "") return "";
  
  // Handle various date formats and normalize to YYYY-MM-DD
  const parts = str.split(/[\/\-\s]/);
  if (parts.length >= 3) {
    let day, month, year;
    
    if (parts[0].length === 4) {
      // Starts with Year: YYYY-MM-DD or YYYY-DD-MM
      year = parts[0];
      const p1 = parseInt(parts[1]);
      const p2 = parseInt(parts[2]);
      
      if (p1 > 12) {
        // YYYY-DD-MM -> Swap to YYYY-MM-DD
        day = parts[1];
        month = parts[2];
      } else {
        // Assume YYYY-MM-DD
        month = parts[1];
        day = parts[2];
      }
    } else {
      // Starts with Day or Month: DD/MM/YYYY or MM/DD/YYYY
      const p1 = parseInt(parts[0]);
      const p2 = parseInt(parts[1]);
      year = parts[2];
      
      if (p1 > 12) {
        // DD/MM/YYYY
        day = parts[0];
        month = parts[1];
      } else if (p2 > 12) {
        // MM/DD/YYYY -> Swap to DD/MM/YYYY logic
        month = parts[0];
        day = parts[1];
      } else {
        // Ambiguous, assume DD/MM/YYYY (Indonesian standard)
        day = parts[0];
        month = parts[1];
      }
      
      if (year.length === 2) year = "20" + year;
    }
    
    const finalDay = String(day).padStart(2, '0');
    const finalMonth = String(month).padStart(2, '0');
    return `${year}-${finalMonth}-${finalDay}`;
  }
  
  return str.split(' ')[0];
};

const cleanAmount = (val: any) => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  
  let str = String(val).trim();
  if (str === "") return 0;

  // Remove currency symbols and non-numeric characters except dots, commas, and minus
  str = str.replace(/[^\d.,-]/g, '');

  if (str.includes('.') && str.includes(',')) {
    // Both present. Determine which one is the decimal separator based on last occurrence.
    if (str.lastIndexOf('.') < str.lastIndexOf(',')) {
      // Indonesian format: 1.234.567,89
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,234,567.89
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Only comma present.
    const parts = str.split(',');
    // If multiple commas or exactly 3 digits after the last comma, assume thousands separator
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      str = str.replace(/,/g, '');
    } else {
      // Likely decimal separator: 1234,56
      str = str.replace(',', '.');
    }
  } else if (str.includes('.')) {
    // Only dot present.
    const parts = str.split('.');
    // If multiple dots or exactly 3 digits after the last dot, assume thousands separator
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      str = str.replace(/\./g, '');
    }
    // else: 1234.56 (leave as is)
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
};

export function ProsesMoker() {
  const [step, setStep] = useState<1 | 2>(1);
  const [isGoogleConnected, setIsGoogleConnected] = useState(googleSheetsService.hasToken());
  const [cabangOptions, setCabangOptions] = useState<{ value: string; label: string }[]>([]);
  const [norekMappings, setNorekMappings] = useState<NoRekMapping[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const { addNotification } = useNotifications();

  const [bniData, setBniData] = useState<MokerData[]>([]);
  const [briData, setBriData] = useState<MokerData[]>([]);
  const [bsiData, setBsiData] = useState<MokerData[]>([]);

  const [bniFile, setBniFile] = useState<File | null>(null);
  const [briFile, setBriFile] = useState<File | null>(null);
  const [bsiFile, setBsiFile] = useState<File | null>(null);

  const bniInputRef = useRef<HTMLInputElement>(null);
  const briInputRef = useRef<HTMLInputElement>(null);
  const bsiInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async (showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
        setLoadingMessage('Memuat data pendukung...');
      }
      // 1. Fetch from Firestore (Primary)
      const firestoreCabang = await cabangService.getAll();
      if (firestoreCabang.length > 0) {
        setCabangOptions(firestoreCabang.map(c => ({ value: c.nama, label: c.nama })));
      }

      // 2. Fallback/Supplement from Google Sheets (if connected)
      if (googleSheetsService.hasToken()) {
        const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
        if (spreadsheetId) {
          const values = await googleSheetsService.readData(spreadsheetId, 'Cabang!A2:A');
          if (values && values.length > 0) {
            const sheetOptions = values.map((v: any) => ({ value: v[0], label: v[0] }));
            
            // Merge with existing options, avoiding duplicates
            setCabangOptions(prev => {
              const existingValues = new Set(prev.map(o => o.value));
              const newOptions = sheetOptions.filter(o => !existingValues.has(o.value));
              return [...prev, ...newOptions];
            });
          }
        }
      }

      const mappings = await norekService.getAll();
      setNorekMappings(mappings);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData(false); // Initial fetch without loading indicator
  }, []);

  useEffect(() => {
    if (isGoogleConnected) {
      fetchData(false);
    }
  }, [isGoogleConnected]);

  const handleConnectGoogle = async () => {
    try {
      await googleSheetsService.authorize();
      setIsGoogleConnected(true);
      toast.success('Terhubung ke Google Sheets');
      addNotification('Berhasil menghubungkan Google Sheets', 'Koneksi ke Google Sheets berhasil dilakukan.', 'success');
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

  const getCabang = (keterangan: string) => {
    if (!keterangan) return "-";
    const ketUpper = keterangan.toUpperCase();
    const ketClean = ketUpper.replace(/[^A-Z0-9]/g, '');
    
    for (const mapping of norekMappings) {
      const keyword = mapping.keterangan.toUpperCase().trim();
      const namaCabang = mapping.namaCabang.trim();
      
      if (keyword === "" || namaCabang === "") continue;

      const kwClean = keyword.replace(/[^A-Z0-9]/g, '');
      if (/^\d+$/.test(kwClean) && kwClean.length >= 5) {
        if (ketClean.indexOf(kwClean) !== -1) {
          return namaCabang;
        }
      }

      if (ketUpper.indexOf(keyword) !== -1) {
        return namaCabang; 
      }
    }

    // LOGIKA LAMA (Backup): Jika tidak ada di NoRek, cari kata setelah "CP", "CAB.", "CPS", "CABANG", or "PERUM PEGADAIAN"
    const matchCabang = ketUpper.match(/(?:CP|CAB\.|CPS|CABANG|PERUM PEGADAIAN)\s+([A-Z0-9\s\.\-]+)/);
    if (matchCabang && matchCabang[1]) {
      const teksSetelah = matchCabang[1].trim().split(" ")[0];
      if (teksSetelah.length > 2) {
        // Cari apakah teksSetelah ini mirip dengan salah satu Nama Cabang di norekMappings
        for (const mapping of norekMappings) {
          if (mapping.namaCabang.toUpperCase().includes(teksSetelah)) {
            return mapping.namaCabang;
          }
        }
        return "CP " + teksSetelah;
      }
    }
    
    return "-";
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, bank: 'BNI' | 'BRI' | 'BSI') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (bank === 'BNI') setBniFile(file);
    else if (bank === 'BRI') setBriFile(file);
    else setBsiFile(file);

    setIsLoading(true);
    setLoadingMessage(`Membaca file CMS ${bank}...`);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const arrayBuffer = evt.target?.result;
      if (!arrayBuffer) {
        setIsLoading(false);
        return;
      }
      const wb = XLSX.read(new Uint8Array(arrayBuffer as ArrayBuffer), { type: 'array', cellNF: true });
      
      let ws;
      if (bank === 'BRI') {
        const wsname = wb.SheetNames.find(n => n.trim().toUpperCase() === 'DD_ONLINE_STATEMENT') || 
                       wb.SheetNames.find(n => n.toUpperCase().includes('STATEMENT')) ||
                       wb.SheetNames.find(n => n.toUpperCase().includes('MUTASI')) ||
                       wb.SheetNames.find(n => n.toUpperCase().includes('BRI')) ||
                       wb.SheetNames[0];
        ws = wb.Sheets[wsname];
      } else {
        ws = wb.Sheets[wb.SheetNames[0]];
      }
      
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }) as any[][];
      
      if (bank === 'BNI') {
        parseBankBNI(data);
      } else if (bank === 'BRI') {
        parseBankBRI(data);
      } else if (bank === 'BSI') {
        parseBankBSI(data);
      }
      
      setIsLoading(false);
      toast.success(`Berhasil memuat data CMS ${bank}`);
    };
    reader.readAsArrayBuffer(file);
  };

  const parseBankBNI = (data: any[][]) => {
    const result: MokerData[] = [];
    for (let i = 12; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 25) continue;
      
      const tanggalRaw = row[7];
      let ket = String(row[12] || "").trim();
      const amountRaw = row[21];
      const dcRaw = String(row[23] || "").trim().toUpperCase();
      const amount = cleanAmount(amountRaw);
      
      // Skip header rows or rows with metadata
      const isHeader = /^(no\.|post date|branch|journal|description|amount|db\/cr|balance|page|post)/i.test(ket) ||
                       /^(no\.|post|date|tanggal|tgl|branch|journal|description|amount|db\/cr|balance|page)/i.test(String(tanggalRaw || "").trim());
      if (isHeader) continue;
      
      if (tanggalRaw && !isNaN(amount) && amount > 0) {
        let j = i + 1;
        while (j < data.length) {
          const nextRow = data[j];
          if (!nextRow) break;
          const nextTgl = String(nextRow[7] || "").trim();
          const nextKet = String(nextRow[12] || "").trim();
          
          if (nextTgl === "" && nextKet !== "") {
            const isGarbage = /^(no\.|post date|branch|journal|description|amount|db\/cr|balance|page)/i.test(nextKet);
            if (!isGarbage) ket += " " + nextKet;
            j++;
          } else {
            break;
          }
        }
        
        ket = ket.replace(/\|/g, '').replace(/\s+/g, ' ').trim();
        const dcFinal = dcRaw.includes("D") ? "D" : (dcRaw.includes("C") ? "C" : "-");
        
        result.push({
          id: `bni-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket,
          nominal: amount,
          cabang: getCabang(ket),
          bank: 'BNI',
          type: dcFinal === 'D' ? 'dropping' : 'pooling'
        });
        
        i = j - 1;
      }
    }
    setBniData(result);
  };

  const parseBankBRI = (data: any[][]) => {
    const result: MokerData[] = [];
    
    // Dynamically find the start row by looking for "Tanggal" or "Keterangan"
    let startRow = -1; 
    for (let i = 0; i < Math.min(data.length, 100); i++) {
      const row = data[i];
      if (!row) continue;
      const rowStr = JSON.stringify(row).toUpperCase();
      if ((rowStr.includes("TANGGAL") || rowStr.includes("TGL") || rowStr.includes("DATE")) && 
          (rowStr.includes("KETERANGAN") || rowStr.includes("REMARK") || rowStr.includes("DESCRIPTION"))) {
        startRow = i + 1;
        break;
      }
    }

    if (startRow === -1) {
      startRow = 18;
    }

    // Try to find column indices from the header row
    let colIdx = {
      tanggal: 2,   // C
      keterangan: 6, // G
      debit: 22,    // W
      kredit: 31,   // AF
    };

    if (startRow > 0) {
      const headerRow = data[startRow - 1];
      headerRow.forEach((cell: any, idx: number) => {
        const val = String(cell || "").toUpperCase();
        if (val.includes("TANGGAL") || val === "TGL" || val === "DATE") colIdx.tanggal = idx;
        if (val.includes("KETERANGAN") || val.includes("REMARK") || val.includes("DESCRIPTION")) colIdx.keterangan = idx;
        if (val.includes("DEBET") || val.includes("DEBIT")) colIdx.debit = idx;
        if (val.includes("KREDIT") || val.includes("CREDIT")) colIdx.kredit = idx;
      });
    }

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 7) continue;
      
      const tanggalRaw = row[colIdx.tanggal];
      let ket = String(row[colIdx.keterangan] || "").trim();
      const debit = cleanAmount(row[colIdx.debit]);
      const kredit = cleanAmount(row[colIdx.kredit]);
      
      let amount = 0;
      let dcFinal = "";

      if (debit > 0) {
        amount = debit;
        dcFinal = "D";
      } else if (kredit > 0) {
        amount = kredit;
        dcFinal = "C";
      }

      const isTanggalNotEmpty = tanggalRaw !== null && tanggalRaw !== undefined && String(tanggalRaw).trim() !== "";

      if (isTanggalNotEmpty && amount > 0) {
        // LOGIKA LOOK-AHEAD
        let j = i + 1;
        while (j < data.length) {
          const nextRow = data[j];
          if (!nextRow) break;
          const nextTgl = String(nextRow[colIdx.tanggal] || "").trim();
          const nextKet = String(nextRow[colIdx.keterangan] || "").trim();
          
          if (nextTgl === "" && nextKet !== "") {
            if (!/halaman|page|saldo awal|opening balance/i.test(nextKet)) {
              ket += " " + nextKet;
            }
            j++;
          } else {
            break;
          }
        }
        
        ket = ket.replace(/\|/g, '').replace(/\s+/g, ' ').trim();
        
        result.push({
          id: `bri-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket,
          nominal: amount,
          cabang: getCabang(ket),
          bank: 'BRI',
          type: dcFinal === 'D' ? 'dropping' : 'pooling'
        });
        
        i = j - 1;
      }
    }
    setBriData(result);
  };

  const parseBankBSI = (data: any[][]) => {
    const result: MokerData[] = [];
    
    let startRow = 12; // Default fallback
    for (let i = 0; i < Math.min(data.length, 50); i++) {
      const row = data[i];
      if (!row) continue;
      const rowStr = JSON.stringify(row).toUpperCase();
      if (rowStr.includes("DATE") && rowStr.includes("DESCRIPTION") && rowStr.includes("AMOUNT")) {
        startRow = i + 1;
        break;
      }
    }

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 8) continue;
      
      const tanggalRaw = row[0]; // Col A
      const ket = String(row[2] || "").trim(); // Col C
      const amountRaw = row[4]; // Col E
      const dbRaw = String(row[5] || "").trim().toUpperCase(); // Col F
      const crRaw = String(row[6] || "").trim().toUpperCase(); // Col G

      const amount = cleanAmount(amountRaw);
      
      if (tanggalRaw && amount > 0) {
        let dcFinal = "";
        if (dbRaw === "DB") dcFinal = "D";
        else if (crRaw === "CR") dcFinal = "C";
        
        result.push({
          id: `bsi-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket,
          nominal: amount,
          cabang: getCabang(ket),
          bank: 'BSI',
          type: dcFinal === 'D' ? 'dropping' : 'pooling'
        });
      }
    }
    setBsiData(result);
  };

  const isCabangValid = (cabang: string) => {
    if (!cabang || cabang === "-") return false;
    const cleanInput = cabang.replace(/^(CP|CPS|UPS|UPC|CAB\.)\s+/i, '').trim().toUpperCase();
    const isValid = cabangOptions.some(c => {
      const cleanOption = c.value.replace(/^(CP|CPS|UPS|UPC|CAB\.)\s+/i, '').trim().toUpperCase();
      return cleanOption === cleanInput || c.value.toUpperCase() === cabang.toUpperCase();
    });
    return isValid;
  };

  const handleSaveMoker = async () => {
    if (!isGoogleConnected) {
      toast.error('Silakan hubungkan Google Sheets terlebih dahulu');
      return;
    }

    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('ID Spreadsheet belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Menyimpan rekap moker...');

    try {
      const allData = [...bniData, ...briData, ...bsiData];
      if (allData.length === 0) {
        toast.error('Tidak ada data untuk disimpan');
        setIsLoading(false);
        return;
      }

      const rows = allData.map(item => {
        const dropping = item.type === 'dropping' ? item.nominal : 0;
        const pooling = item.type === 'pooling' ? item.nominal : 0;
        const net = dropping - pooling;
        return [item.tanggal, item.bank, item.cabang, dropping, pooling, net];
      });

      const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, 'RekapMoker');
      if (sheetId === null) {
        toast.error('Sheet "RekapMoker" tidak ditemukan');
        setIsLoading(false);
        return;
      }

      await googleSheetsService.insertRows(spreadsheetId, sheetId, 1, rows.length);
      await googleSheetsService.updateData(spreadsheetId, `RekapMoker!A2`, rows);

      toast.success('Rekap Moker berhasil disimpan');
      addNotification('Simpan Rekap Moker Berhasil', `Berhasil menyimpan ${rows.length} data rekap moker ke Google Sheets.`, 'success');
      
      setBniData([]);
      setBriData([]);
      setBsiData([]);
      setBniFile(null);
      setBriFile(null);
      setBsiFile(null);
      setStep(1);
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error(`Gagal menyimpan data: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const updateCabang = (bank: 'BNI' | 'BRI' | 'BSI', id: string, newCabang: string) => {
    const updateFn = (prev: MokerData[]) => prev.map(item => item.id === id ? { ...item, cabang: newCabang } : item);
    if (bank === 'BNI') setBniData(updateFn);
    else if (bank === 'BRI') setBriData(updateFn);
    else setBsiData(updateFn);
  };

  const renderTable = (bank: 'BNI' | 'BRI' | 'BSI', data: MokerData[]) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
      <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Database className="w-4 h-4 text-[#009B4F]" />
          Data CMS {bank}
        </h3>
        <span className="text-xs font-medium px-2 py-1 bg-white border border-gray-200 rounded-full text-gray-500">
          {data.length} Transaksi
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-gray-50/30">
            <tr>
              <th className="px-6 py-3 font-semibold">Tanggal</th>
              <th className="px-6 py-3 font-semibold">Keterangan</th>
              <th className="px-6 py-3 font-semibold text-right">Nominal</th>
              <th className="px-6 py-3 font-semibold">Cabang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.length > 0 ? data.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4 font-medium text-gray-600">{item.tanggal}</td>
                <td className="px-6 py-4 text-gray-500 max-w-xs truncate" title={item.keterangan}>{item.keterangan}</td>
                <td className={`px-6 py-4 text-right font-bold ${item.type === 'dropping' ? 'text-green-600' : 'text-red-600'}`}>
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(item.nominal)}
                </td>
                <td className="px-6 py-4 min-w-[200px]">
                  <Select
                    options={cabangOptions}
                    value={cabangOptions.find(o => o.value === item.cabang) || { value: item.cabang, label: item.cabang }}
                    onChange={(val) => updateCabang(bank, item.id, val?.value || '-')}
                    onInputChange={(val) => {
                      if (val) updateCabang(bank, item.id, val);
                    }}
                    className="text-xs"
                    placeholder="Pilih Cabang..."
                    isSearchable
                    styles={{
                      control: (base) => ({
                        ...base,
                        minHeight: '30px',
                        borderColor: isCabangValid(item.cabang) ? '#10b981' : '#ef4444',
                        borderWidth: '2px',
                        '&:hover': {
                          borderColor: isCabangValid(item.cabang) ? '#059669' : '#dc2626',
                        }
                      }),
                      valueContainer: (base) => ({ ...base, padding: '0 8px' }),
                      input: (base) => ({ ...base, margin: '0' }),
                      menu: (base) => ({ ...base, zIndex: 50 }),
                      option: (base, state) => ({
                        ...base,
                        fontSize: '0.75rem',
                        backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#f0fdf4' : 'white',
                        color: state.isSelected ? 'white' : '#374151',
                      })
                    }}
                  />
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-400">Belum ada data diunggah</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-50/50 overflow-hidden">
      <div className="p-6 flex-shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Proses Modal Kerja</h1>
              <p className="text-sm text-gray-500">Kelola dropping dan pooling modal kerja antar cabang</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isGoogleConnected ? (
              <button 
                onClick={handleConnectGoogle}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-all text-xs font-bold shadow-sm cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="text-red-600">[WAJIB]</span> Hubungkan Google Sheet
              </button>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 text-xs font-bold shadow-sm">
                <CheckCircle className="w-4 h-4" />
                Terhubung ke Google Sheets
              </div>
            )}
          </div>
        </div>

        {/* Stepper */}
        <div className="mt-8">
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-3 ${step >= 1 ? 'text-[#009B4F]' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= 1 ? 'bg-[#009B4F] text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
              <span className="font-semibold text-sm">Upload File</span>
            </div>
            <div className="h-[1px] w-12 bg-gray-200"></div>
            <div className={`flex items-center gap-3 ${step >= 2 ? 'text-[#009B4F]' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= 2 ? 'bg-[#009B4F] text-white' : 'bg-gray-200 text-gray-500'}`}>2</div>
              <span className="font-semibold text-sm">Review Data Moker</span>
            </div>
          </div>
        </div>
      </div>

      {step === 1 ? (
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
            {(['BNI', 'BRI', 'BSI'] as const).map((bank) => (
              <div key={bank} className="bg-white p-10 rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center transition-all hover:shadow-md">
                <div className="w-16 h-16 bg-[#C4D600]/10 rounded-full flex items-center justify-center mb-6">
                  <FileSpreadsheet className="w-8 h-8 text-[#8A9A00]" />
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-2">Upload Data CMS {bank}</h3>
                <p className="text-xs text-gray-500 mb-8">Pilih file Excel dari Mutasi CMS {bank} (format .xlsx)</p>
                
                <input
                  type="file"
                  ref={bank === 'BNI' ? bniInputRef : bank === 'BRI' ? briInputRef : bsiInputRef}
                  onChange={(e) => handleFileUpload(e, bank)}
                  className="hidden"
                  accept=".xlsx,.xls"
                />
                
                <button
                  onClick={() => (bank === 'BNI' ? bniInputRef : bank === 'BRI' ? briInputRef : bsiInputRef).current?.click()}
                  className={`px-8 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm ${
                    (bank === 'BNI' ? bniData : bank === 'BRI' ? briData : bsiData).length > 0
                      ? 'bg-emerald-50 text-[#009B4F] border border-emerald-100'
                      : 'bg-[#C4D600] hover:bg-[#B5C600] text-gray-900'
                  }`}
                >
                  {(bank === 'BNI' ? bniData : bank === 'BRI' ? briData : bsiData).length > 0 ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      File Terunggah
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Pilih File Bank
                    </>
                  )}
                </button>
                {(bank === 'BNI' ? bniFile : bank === 'BRI' ? briFile : bsiFile) && (
                  <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-[#8A9A00] bg-[#C4D600]/5 px-3 py-2 rounded-lg w-full overflow-hidden border border-[#C4D600]/10">
                    <CheckCircle className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{(bank === 'BNI' ? bniFile : bank === 'BRI' ? briFile : bsiFile)?.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-12">
            <button
              onClick={() => setStep(2)}
              disabled={bniData.length === 0 && briData.length === 0 && bsiData.length === 0}
              className={`px-8 py-4 rounded-2xl font-bold text-sm flex items-center gap-3 transition-all ${
                bniData.length > 0 || briData.length > 0 || bsiData.length > 0
                  ? 'bg-[#009B4F] hover:bg-[#008543] text-white shadow-lg shadow-[#009B4F]/20 cursor-pointer'
                  : 'bg-[#e2e8f0] text-[#94a3b8] cursor-not-allowed'
              }`}
            >
              Lanjut Review Data Moker
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden px-6 pb-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="font-black text-gray-800 uppercase tracking-widest text-sm">Review Data Moker</h3>
                <p className="text-xs text-gray-500 mt-1">Periksa data CMS Bank. Pastikan cabang sudah sesuai.</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition-all cursor-pointer text-xs uppercase tracking-widest border border-gray-200 bg-white"
                >
                  Kembali
                </button>
                <button
                  onClick={handleSaveMoker}
                  className="bg-[#009B4F] hover:bg-[#008543] text-white px-6 py-2.5 rounded-xl font-black flex items-center gap-2 transition-all shadow-lg shadow-[#009B4F]/20 cursor-pointer text-xs uppercase tracking-widest"
                >
                  <Save className="w-4 h-4" />
                  Simpan Rekap Moker
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-8 bg-gray-50/30">
              {renderTable('BNI', bniData)}
              {renderTable('BRI', briData)}
              {renderTable('BSI', bsiData)}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-xs w-full">
            <div className="w-12 h-12 border-4 border-[#009B4F]/20 border-t-[#009B4F] rounded-full animate-spin mx-auto mb-4" />
            <p className="font-bold text-gray-800">{loadingMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
