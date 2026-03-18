import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight, Save, Play, RefreshCw, X, Download, FileText, Database } from 'lucide-react';
import * as XLSX from 'xlsx';
import Select from 'react-select';
import toast from 'react-hot-toast';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { googleSheetsService } from '../services/googleSheetsService';

import { norekService, NoRekMapping } from '../services/norekService';
import { cabangService } from '../services/cabangService';

// --- Types ---
interface SistemData {
  id: string;
  tanggal: string;
  keterangan: string;
  debit: number;
  kredit: number;
  balance: number;
  cabang: string;
  kategori: string;
  nominalNormal: number;
  catatan?: string;
}

interface BankData {
  id: string;
  tanggal: string;
  keterangan: string;
  amount: number;
  dc: string;
  balance: number;
  cabang: string;
  kategori: string;
  nominalNormal: number;
  catatan?: string;
}

const CABANG_LIST: { value: string; label: string }[] = [];

interface RekonResult {
  cocok: { sys: SistemData; bnk: BankData }[];
  hanyaDiSistem: SistemData[];
  hanyaDiBank: BankData[];
  analisa: {
    balanceAkhirSistem: number;
    balanceAkhirBank: number;
    selisihRCSistem: number;
    totalBelumDibukukan: number;
    totalOutstanding: number;
    selisihNetto: number;
    seharusnyaBalance: number;
  };
}

// --- Helper Functions ---
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

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
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

interface RekonBNIProps {
  bank?: string;
  initialData?: {
    bank: string;
    sistemData: any[];
    bankData: any[];
    rowIndices?: number[];
  } | null;
  onClearInitialData?: () => void;
  setIsLoading?: (loading: boolean) => void;
  setLoadingMessage?: (msg: string) => void;
}

export function RekonBNI({ 
  bank = 'BNI', 
  initialData,
  onClearInitialData,
  setIsLoading = () => {}, 
  setLoadingMessage = () => {} 
}: RekonBNIProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [cabangOptions, setCabangOptions] = useState<{ value: string; label: string }[]>([]);
  const [norekMappings, setNorekMappings] = useState<NoRekMapping[]>([]);
  const [sistemFile, setSistemFile] = useState<File | null>(null);

  const [bankFile, setBankFile] = useState<File | null>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(googleSheetsService.hasToken());

  const handleConnectGoogle = async () => {
    try {
      await googleSheetsService.authorize();
      setIsGoogleConnected(true);
      toast.success('Terhubung ke Google Sheets');
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

  const fetchCabang = async () => {
    try {
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
      
      // Also fetch NoRek mappings from Firestore
      const mappings = await norekService.getAll();
      setNorekMappings(mappings);
    } catch (error) {
      console.error('Error fetching cabang list:', error);
    }
  };

  useEffect(() => {
    if (initialData && initialData.bank === bank) {
      setSistemData(initialData.sistemData);
      setBankData(initialData.bankData);
      setStep(2);
      toast.success('Data rekon dimuat untuk update');
      if (onClearInitialData) onClearInitialData();
    }
  }, [initialData, bank]);

  useEffect(() => {
    if (isGoogleConnected) {
      fetchCabang();
    }
  }, [isGoogleConnected]);

  // Also fetch on mount if already connected
  useEffect(() => {
    if (googleSheetsService.hasToken()) {
      fetchCabang();
    }
  }, []);
  
  const [sistemData, setSistemData] = useState<SistemData[]>([]);
  const [bankData, setBankData] = useState<BankData[]>([]);
  
  const [rekonResult, setRekonResult] = useState<RekonResult | null>(null);
  const [activeTabResult, setActiveTabResult] = useState<'cocok' | 'sistem' | 'bank' | 'analisa'>('cocok');

  // --- Step 1: Upload & Parse ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'sistem' | 'bank') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'sistem') setSistemFile(file);
    else setBankFile(file);

    setLoadingMessage(`Membaca file ${type === 'sistem' ? 'Sistem' : 'Bank'}...`);
    setIsLoading(true);

    setTimeout(() => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const arrayBuffer = evt.target?.result;
        if (!arrayBuffer) {
          setIsLoading(false);
          return;
        }
        
        // Use Uint8Array for better compatibility with XLSX.read
        const wb = XLSX.read(new Uint8Array(arrayBuffer as ArrayBuffer), { type: 'array', cellNF: true });
        
        console.log('File loaded. Sheet names:', wb.SheetNames);
        console.log('Active bank:', bank, 'Type:', type);

        let ws;
        if (type === 'bank' && bank === 'BRI') {
          // More robust sheet selection
          const wsname = wb.SheetNames.find(n => n.trim().toUpperCase() === 'DD_ONLINE_STATEMENT') || 
                         wb.SheetNames.find(n => n.toUpperCase().includes('STATEMENT')) ||
                         wb.SheetNames.find(n => n.toUpperCase().includes('MUTASI')) ||
                         wb.SheetNames.find(n => n.toUpperCase().includes('BRI')) ||
                         wb.SheetNames[0];
          console.log('Selected sheet for BRI:', wsname);
          ws = wb.Sheets[wsname];
        } else {
          const wsname = wb.SheetNames[0];
          ws = wb.Sheets[wsname];
        }
        
        // Use raw: false to get formatted strings, similar to how Apps Script getValues() often behaves
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
        console.log('Rows parsed:', data.length);
        if (data.length > 0) {
          console.log('Raw data first 10 rows:', data.slice(0, 10));
        }

        if (type === 'sistem') {
          parseSistem(data as any[][]);
        } else {
          if (bank === 'BRI') {
            parseBankBRI(data as any[][]);
          } else if (bank === 'BSI') {
            parseBankBSI(data as any[][]);
          } else {
            parseBank(data as any[][]);
          }
        }
        setIsLoading(false);
      };
      reader.readAsArrayBuffer(file);
    }, 100);
  };

  const parseSistem = (data: any[][]) => {
    const result: SistemData[] = [];
    for (let i = 12; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 10) continue;
      
      const tanggalRaw = row[0];
      const textUtama = String(row[4] || "").trim();
      const longText = String(row[11] || "").trim();
      const debit = cleanAmount(row[7]);
      const kredit = cleanAmount(row[8]);
      const balance = cleanAmount(row[9]);
      
      const keteranganFinal = textUtama !== "" ? textUtama : longText;
      const teksCek = keteranganFinal.toLowerCase();
      const tglCek = String(tanggalRaw || "").toLowerCase();
      
      const isHeaderFooter = teksCek.includes("saldo awal") ||
                             teksCek.includes("mutasi debit") ||
                             teksCek.includes("mutasi kredit") ||
                             teksCek.includes("saldo akhir") ||
                             tglCek.includes("saldo awal") ||
                             tglCek.includes("mutasi debit") ||
                             tglCek.includes("mutasi kredit") ||
                             tglCek.includes("saldo akhir") ||
                             tglCek.includes("jumlah mutasi");
                             
      if (tanggalRaw && String(tanggalRaw).trim() !== "" && !isHeaderFooter) {
        const regex = /(CP|CPS|UPS|UPC)\s+([A-Z\s]+?)(?=\s+\d|\s*\||\s*-$|$)/i;
        const match = keteranganFinal.match(regex);
        const namaCabang = match ? `${match[1].toUpperCase()} ${match[2].trim().toUpperCase()}` : "-";
        const kategori = namaCabang !== "-" ? "Non Pembayaran" : "Pembayaran";
        const nominalNormal = (debit > 0 ? Math.abs(debit) : -Math.abs(kredit));
        
        result.push({
          id: `sys-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: keteranganFinal,
          debit: Math.abs(debit),
          kredit: Math.abs(kredit),
          balance: balance,
          cabang: namaCabang,
          kategori,
          nominalNormal
        });
      }
    }
    setSistemData(result);
  };

  const getCabang = (keterangan: string) => {
    if (!keterangan) return "-";
    const ketUpper = keterangan.toUpperCase();
    // Clean version for numeric matching (remove spaces, dots, commas, etc)
    const ketClean = ketUpper.replace(/[^A-Z0-9]/g, '');
    
    // LOGIKA BARU: Pencocokan berdasarkan data di norekMappings (Firestore)
    for (const mapping of norekMappings) {
      const keyword = mapping.keterangan.toUpperCase().trim();
      const namaCabang = mapping.namaCabang.trim();
      
      if (keyword === "" || namaCabang === "") continue;

      // Robust matching for account numbers (mostly digits)
      const kwClean = keyword.replace(/[^A-Z0-9]/g, '');
      if (/^\d+$/.test(kwClean) && kwClean.length >= 5) {
        if (ketClean.indexOf(kwClean) !== -1) {
          return namaCabang;
        }
      }

      // Standard substring matching
      if (ketUpper.indexOf(keyword) !== -1) {
        return namaCabang; 
      }
    }

    // LOGIKA LAMA (Backup): Jika tidak ada di NoRek, cari kata setelah "CP", "CAB.", or "CPS"
    const matchCabang = ketUpper.match(/(?:CP|CAB\.|CPS)\s+([A-Z0-9\s\.\-]+)/);
    if (matchCabang && matchCabang[1]) {
      const teksSetelah = matchCabang[1].trim().split(" ")[0];
      if (teksSetelah.length > 3) {
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

  const parseBankBRI = (data: any[][]) => {
    console.log('Starting parseBankBRI with total rows:', data.length);
    const result: BankData[] = [];
    
    // Dynamically find the start row by looking for "Tanggal" or "Keterangan"
    let startRow = -1; 
    for (let i = 0; i < Math.min(data.length, 100); i++) {
      const row = data[i];
      if (!row) continue;
      const rowStr = JSON.stringify(row).toUpperCase();
      // Broaden search: "TGL", "TANGGAL", "DATE", "KETERANGAN", "DESCRIPTION", "REMARK"
      if ((rowStr.includes("TANGGAL") || rowStr.includes("TGL") || rowStr.includes("DATE")) && 
          (rowStr.includes("KETERANGAN") || rowStr.includes("REMARK") || rowStr.includes("DESCRIPTION"))) {
        startRow = i + 1;
        console.log('Found BRI header at row:', i + 1, 'Data starts at row:', startRow + 1);
        break;
      }
    }

    if (startRow === -1) {
      console.warn('Could not find BRI header row. Falling back to row 19 (index 18).');
      startRow = 18;
    }

    // Try to find column indices from the header row
    let colIdx = {
      tanggal: 2,   // C
      keterangan: 6, // G
      debit: 22,    // W
      kredit: 31,   // AF
      balance: 38   // AM
    };

    if (startRow > 0) {
      const headerRow = data[startRow - 1];
      headerRow.forEach((cell: any, idx: number) => {
        const val = String(cell || "").toUpperCase();
        if (val.includes("TANGGAL") || val === "TGL" || val === "DATE") colIdx.tanggal = idx;
        if (val.includes("KETERANGAN") || val.includes("REMARK") || val.includes("DESCRIPTION")) colIdx.keterangan = idx;
        if (val.includes("DEBET") || val.includes("DEBIT")) colIdx.debit = idx;
        if (val.includes("KREDIT") || val.includes("CREDIT")) colIdx.kredit = idx;
        if (val.includes("SALDO") || val.includes("BALANCE")) colIdx.balance = idx;
      });
      console.log('Detected BRI column indices:', colIdx);
    }

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 7) continue;
      
      const tanggalRaw = row[colIdx.tanggal];
      let ket = String(row[colIdx.keterangan] || "").trim();
      const debitRaw = row[colIdx.debit];
      const kreditRaw = row[colIdx.kredit];
      const rowBalance = cleanAmount(row[colIdx.balance]);

      const debit = cleanAmount(debitRaw);
      const kredit = cleanAmount(kreditRaw);
      
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
        
        const namaCabang = getCabang(ket);
        const kategori = namaCabang !== "-" ? "Non Pembayaran" : "Pembayaran";
        
        const nominalNormal = (dcFinal === 'D' ? -Math.abs(amount) : Math.abs(amount));
        
        if (result.length === 0) {
          console.log('First BRI transaction found:', { tanggalRaw, ket, amount, dcFinal });
        }

        result.push({
          id: `bnk-bri-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket,
          amount: amount,
          dc: dcFinal,
          balance: rowBalance,
          cabang: namaCabang,
          kategori,
          nominalNormal
        });
        
        i = j - 1;
      }
    }
    console.log('Finished parseBankBRI. Found valid rows:', result.length);
    setBankData(result);
  };

  const parseBankBSI = (data: any[][]) => {
    console.log('Starting parseBankBSI with total rows:', data.length);
    const result: BankData[] = [];
    
    // BSI format based on user request:
    // Tgl (Col A), Uraian (Col C), Amount (Col E), DB (Col F), CR (Col G), Balance (Col H)
    // Data starts after header (usually row 13, index 12)
    
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
      const balanceRaw = row[7]; // Col H

      const amount = cleanAmount(amountRaw);
      const balance = cleanAmount(balanceRaw);
      
      if (tanggalRaw && amount > 0) {
        let dcFinal = "";
        if (dbRaw === "DB") dcFinal = "D";
        else if (crRaw === "CR") dcFinal = "C";
        
        const namaCabang = getCabang(ket);
        const kategori = namaCabang !== "-" ? "Non Pembayaran" : "Pembayaran";
        const nominalNormal = (dcFinal === 'D' ? -Math.abs(amount) : Math.abs(amount));

        result.push({
          id: `bnk-bsi-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket,
          amount: amount,
          dc: dcFinal,
          balance: balance,
          cabang: namaCabang,
          kategori,
          nominalNormal
        });
      }
    }
    console.log('Finished parseBankBSI. Found valid rows:', result.length);
    setBankData(result);
  };

  const parseBank = (data: any[][]) => {
    const result: BankData[] = [];
    for (let i = 12; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 25) continue;
      
      const tanggalRaw = row[7];
      let ket = String(row[12] || "").trim();
      const amountRaw = row[21];
      const dcRaw = String(row[23] || "").trim().toUpperCase();
      const balance = cleanAmount(row[24]);
      const amount = cleanAmount(amountRaw);
      
      // Skip header rows or rows with metadata
      const isHeader = /^(no\.|post date|branch|journal|description|amount|db\/cr|balance|page|post)/i.test(ket) ||
                       /^(no\.|post|date|tanggal|tgl|branch|journal|description|amount|db\/cr|balance|page)/i.test(String(tanggalRaw || "").trim());
      if (isHeader) continue;
      
      if (tanggalRaw && !isNaN(amount)) {
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
        
        const matchCabang = ket.match(/(?:CABANG|CAB\.|PERUM PEGADAIAN)\s+([A-Z0-9\s\.\-]+)/i);
        let namaCabang = "-";
        if (matchCabang && matchCabang[1]) {
          namaCabang = "CP " + matchCabang[1].trim().split(" ")[0].toUpperCase();
        }
        
        const kategori = namaCabang !== "-" ? "Non Pembayaran" : "Pembayaran";
        const nominalNormal = (dcFinal === 'D' ? -Math.abs(amount) : Math.abs(amount));
        
        result.push({
          id: `bnk-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket,
          amount: amount,
          dc: dcFinal,
          balance: balance,
          cabang: namaCabang,
          kategori,
          nominalNormal
        });
        
        i = j - 1;
      }
    }
    setBankData(result);
  };

  const handleLanjutReview = () => {
    if (sistemData.length > 0 && bankData.length > 0) {
      setStep(2);
      toast.success('File berhasil diunggah dan diproses');
    } else {
      toast.error("Pastikan kedua file telah diupload dan berisi data yang valid.");
    }
  };

  // --- Step 2: Review & Edit ---
  const handleCabangChange = (id: string, newCabang: string, type: 'sistem' | 'bank') => {
    const isValid = isCabangValid(newCabang);
    const kategori = isValid ? "Non Pembayaran" : "Pembayaran";
    
    if (type === 'sistem') {
      setSistemData(prev => prev.map(item => item.id === id ? { ...item, cabang: newCabang.toUpperCase(), kategori } : item));
    } else {
      setBankData(prev => prev.map(item => item.id === id ? { ...item, cabang: newCabang.toUpperCase(), kategori } : item));
    }
  };

  const handleProsesRekon = () => {
    setLoadingMessage('Mencocokkan data rekonsiliasi...');
    setIsLoading(true);

    setTimeout(() => {
      try {
        const cocok: { sys: SistemData; bnk: BankData }[] = [];
        let hanyaDiSistem: SistemData[] = [];
        let hanyaDiBank: BankData[] = [];
        
        // 1. Process all data regardless of category
        const sysToProcess = [...sistemData];
        const bnkToProcess = [...bankData];
        
        const matchedBankIndices = new Set<number>();
      
        // 2. Individual Row Matching
        sysToProcess.forEach(sys => {
          let isMatched = false;
          for (let j = 0; j < bnkToProcess.length; j++) {
            if (matchedBankIndices.has(j)) continue;
            const bnk = bnkToProcess[j];
            
            // Match by Date, Branch, and Nominal
            if (sys.tanggal === bnk.tanggal && sys.cabang === bnk.cabang && Math.abs(sys.nominalNormal - bnk.nominalNormal) < 0.01) {
              cocok.push({ sys, bnk });
              matchedBankIndices.add(j);
              isMatched = true;
              break;
            }
          }
          if (!isMatched) {
            hanyaDiSistem.push(sys);
          }
        });

        // Initial onlyDiBank
        bnkToProcess.forEach((bnk, j) => {
          if (!matchedBankIndices.has(j)) {
            hanyaDiBank.push(bnk);
          }
        });
        
        // 3. Aggregation Logic (Cumulative Match per Branch)
        // Group remaining items by Branch
        const sistemByCabang: Record<string, { total: number; items: SistemData[] }> = {};
        const bankByCabang: Record<string, { total: number; items: BankData[] }> = {};
        
        hanyaDiSistem.forEach((row) => {
          const cab = row.cabang;
          if (!sistemByCabang[cab]) sistemByCabang[cab] = { total: 0, items: [] };
          sistemByCabang[cab].total += row.nominalNormal;
          sistemByCabang[cab].items.push(row);
        });
        
        hanyaDiBank.forEach((row) => {
          const cab = row.cabang;
          if (!bankByCabang[cab]) bankByCabang[cab] = { total: 0, items: [] };
          bankByCabang[cab].total += row.nominalNormal;
          bankByCabang[cab].items.push(row);
        });
        
        const finalHanyaDiSistem: SistemData[] = [];
        const finalHanyaDiBank: BankData[] = [];
        
        // Check for matches in totals per branch
        const allCabangs = new Set([...Object.keys(sistemByCabang), ...Object.keys(bankByCabang)]);
        
        allCabangs.forEach(cab => {
          const sysGroup = sistemByCabang[cab];
          const bnkGroup = bankByCabang[cab];
          
          if (sysGroup && bnkGroup && Math.abs(sysGroup.total - bnkGroup.total) < 0.01) {
            // It's a cumulative match!
            const maxLen = Math.max(sysGroup.items.length, bnkGroup.items.length);
            for (let i = 0; i < maxLen; i++) {
              const s = sysGroup.items[i];
              const b = bnkGroup.items[i];
              
              if (s && b) {
                cocok.push({ sys: s, bnk: b });
              } else if (s) {
                cocok.push({ 
                  sys: s, 
                  bnk: { 
                    id: `dummy-bnk-${s.id}`, 
                    tanggal: s.tanggal, 
                    keterangan: "(Agregasi)", 
                    amount: 0, 
                    dc: "", 
                    balance: 0, 
                    cabang: s.cabang, 
                    kategori: s.kategori,
                    nominalNormal: 0 
                  } 
                });
              } else if (b) {
                cocok.push({ 
                  sys: { 
                    id: `dummy-sys-${b.id}`, 
                    tanggal: b.tanggal, 
                    keterangan: "(Agregasi)", 
                    debit: 0, 
                    kredit: 0, 
                    balance: 0, 
                    cabang: b.cabang, 
                    kategori: b.kategori,
                    nominalNormal: 0 
                  }, 
                  bnk: b 
                });
              }
            }
          } else {
            if (sysGroup) finalHanyaDiSistem.push(...sysGroup.items);
            if (bnkGroup) finalHanyaDiBank.push(...bnkGroup.items);
          }
        });
        
        hanyaDiSistem = finalHanyaDiSistem;
        hanyaDiBank = finalHanyaDiBank;
        
        // 4. Self-Cancellation (Hanya di Sistem)
        const finalSistemAfterCancel: SistemData[] = [];
        const skipIndex = new Set<number>();
        
        for (let i = 0; i < hanyaDiSistem.length; i++) {
          if (skipIndex.has(i)) continue;
          const rowI = hanyaDiSistem[i];
          let foundKoreksi = false;
          
          for (let j = i + 1; j < hanyaDiSistem.length; j++) {
            if (skipIndex.has(j)) continue;
            const rowJ = hanyaDiSistem[j];
            
            if (rowI.tanggal === rowJ.tanggal && rowI.cabang === rowJ.cabang && Math.abs(rowI.nominalNormal + rowJ.nominalNormal) < 0.01) {
              skipIndex.add(i);
              skipIndex.add(j);
              foundKoreksi = true;
              break;
            }
          }
          
          if (!foundKoreksi) {
            finalSistemAfterCancel.push(rowI);
          }
        }
        
        hanyaDiSistem = finalSistemAfterCancel;
        
        // Sort results
        cocok.sort((a, b) => a.sys.cabang.localeCompare(b.sys.cabang));
        hanyaDiSistem.sort((a, b) => a.cabang.localeCompare(b.cabang));
        hanyaDiBank.sort((a, b) => a.cabang.localeCompare(b.cabang));

        // 5. Analisa
        const balanceAkhirSistem = sistemData.length > 0 ? sistemData[sistemData.length - 1].balance : 0;
        const balanceAkhirBank = bankData.length > 0 ? bankData[bankData.length - 1].balance : 0;
        const selisihRCSistem = balanceAkhirBank - balanceAkhirSistem;
        const totalOutstanding = hanyaDiSistem.reduce((sum, row) => sum + row.nominalNormal, 0);
        const totalBelumDibukukan = hanyaDiBank.reduce((sum, row) => sum + row.nominalNormal, 0);
        const selisihNetto = totalBelumDibukukan - totalOutstanding;
        const seharusnyaBalance = balanceAkhirSistem + selisihNetto;

        setRekonResult({
          cocok,
          hanyaDiSistem,
          hanyaDiBank,
          analisa: {
            balanceAkhirSistem,
            balanceAkhirBank,
            selisihRCSistem,
            totalBelumDibukukan,
            totalOutstanding,
            selisihNetto,
            seharusnyaBalance
          }
        });
      } catch (error: any) {
        console.error('Error in handleProsesRekon:', error);
        toast.error(`Gagal memproses rekonsiliasi: ${error.message}`);
      } finally {
        setIsLoading(false);
        setStep(3);
      }
    }, 500);
  };

  const handleCatatanChange = (id: string, value: string, type: 'sistem' | 'bank') => {
    if (!rekonResult) return;
    const newResult = { ...rekonResult };
    if (type === 'sistem') {
      newResult.hanyaDiSistem = newResult.hanyaDiSistem.map(item => item.id === id ? { ...item, catatan: value } : item);
    } else {
      newResult.hanyaDiBank = newResult.hanyaDiBank.map(item => item.id === id ? { ...item, catatan: value } : item);
    }
    setRekonResult(newResult);
  };

  const isCabangValid = (cabang: string) => {
    if (!cabang || cabang === "-") return false;
    
    // Normalize input: remove prefixes and trim
    const cleanInput = cabang.replace(/^(CP|CPS|UPS|UPC|CAB\.)\s+/i, '').trim().toUpperCase();
    
    // Check against options, also normalizing them
    const isValid = cabangOptions.some(c => {
      const cleanOption = c.value.replace(/^(CP|CPS|UPS|UPC|CAB\.)\s+/i, '').trim().toUpperCase();
      return cleanOption === cleanInput || c.value.toUpperCase() === cabang.toUpperCase();
    });

    return isValid;
  };

  const exportToExcel = () => {
    if (!rekonResult) return;
    const wb = XLSX.utils.book_new();
    
    // Matched Data
    const matchedData = rekonResult.cocok.map(r => ({
      'Tanggal': r.sys.tanggal,
      'Keterangan': r.sys.keterangan,
      'Bank': bank,
      'Cabang': r.sys.cabang,
      'Nominal Sistem': r.sys.nominalNormal,
      'Nominal Bank': r.bnk.nominalNormal,
      'Selisih': 0,
      'Status': 'Matched',
      'Kategori': r.sys.kategori,
      'Catatan': ''
    }));
    const wsMatched = XLSX.utils.json_to_sheet(matchedData);
    XLSX.utils.book_append_sheet(wb, wsMatched, "Matched");

    // Outstanding Sistem
    const outstandingSistemData = rekonResult.hanyaDiSistem.map(r => ({
      'Tanggal': r.tanggal,
      'Keterangan': r.keterangan,
      'Bank': bank,
      'Cabang': r.cabang,
      'Nominal Sistem': r.nominalNormal,
      'Nominal Bank': 0,
      'Selisih': r.nominalNormal,
      'Status': 'Outstanding Sistem',
      'Kategori': r.kategori,
      'Catatan': r.catatan || ''
    }));
    const wsSistem = XLSX.utils.json_to_sheet(outstandingSistemData);
    XLSX.utils.book_append_sheet(wb, wsSistem, "Outstanding Sistem");

    // Belum Dibukukan
    const belumDibukukanData = rekonResult.hanyaDiBank.map(r => ({
      'Tanggal': r.tanggal,
      'Keterangan': r.keterangan,
      'Bank': bank,
      'Cabang': r.cabang,
      'Nominal Sistem': 0,
      'Nominal Bank': r.nominalNormal,
      'Selisih': -r.nominalNormal,
      'Status': 'Belum Dibukukan',
      'Kategori': r.kategori,
      'Catatan': r.catatan || ''
    }));
    const wsBank = XLSX.utils.json_to_sheet(belumDibukukanData);
    XLSX.utils.book_append_sheet(wb, wsBank, "Belum Dibukukan");

    XLSX.writeFile(wb, `Rekon_${bank}_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('File Excel berhasil diunduh');
  };

  const exportToPDF = () => {
    if (!rekonResult) return;
    const doc = new jsPDF('l', 'mm', 'a4');
    const today = new Date().toISOString().split('T')[0];
    
    doc.setFontSize(16);
    doc.text(`Hasil Rekonsiliasi ${bank} - ${today}`, 14, 15);
    
    doc.setFontSize(12);
    doc.text('1. Data Matched', 14, 25);
    
    const matchedData = rekonResult.cocok.map(r => [
      r.sys.tanggal,
      r.sys.keterangan,
      formatCurrency(r.sys.nominalNormal),
      r.sys.cabang,
      r.bnk.keterangan,
      formatCurrency(r.bnk.nominalNormal),
      r.bnk.cabang
    ]);

    autoTable(doc, {
      head: [['Tgl', 'Ket Sistem', 'Nominal', 'Cabang', 'Ket Bank', 'Nominal', 'Cabang']],
      body: matchedData,
      startY: 30,
      theme: 'grid',
      styles: { fontSize: 7 },
      headStyles: { fillColor: [0, 155, 79] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.text('2. Outstanding Sistem & Belum Dibukukan', 14, finalY);

    const outstandingData = [
      ...rekonResult.hanyaDiSistem.map(r => [r.tanggal, r.keterangan, r.cabang, formatCurrency(r.nominalNormal), '0', formatCurrency(r.nominalNormal), 'Outstanding Sistem', r.catatan || '-']),
      ...rekonResult.hanyaDiBank.map(r => [r.tanggal, r.keterangan, r.cabang, '0', formatCurrency(r.nominalNormal), formatCurrency(-r.nominalNormal), 'Belum Dibukukan', r.catatan || '-'])
    ];

    autoTable(doc, {
      head: [['Tgl', 'Keterangan', 'Cabang', 'Sistem', 'Bank', 'Selisih', 'Tipe', 'Catatan']],
      body: outstandingData,
      startY: finalY + 5,
      theme: 'grid',
      styles: { fontSize: 7 },
      headStyles: { fillColor: [196, 214, 0] }
    });

    doc.save(`Rekon_${bank}_${today}.pdf`);
    toast.success('File PDF berhasil diunduh');
  };

  const saveToGoogleSheet = async () => {
    if (!rekonResult) return;
    
    setLoadingMessage('Menyimpan ke Google Sheets...');
    setIsLoading(true);
    
    try {
      const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID belum dikonfigurasi');
      }

      // 1. Read all existing data
      let allData = await googleSheetsService.readData(spreadsheetId, 'RekonData!A:J');
      const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, 'RekonData');
      
      if (sheetId === null) {
        throw new Error('Sheet "RekonData" tidak ditemukan');
      }

      // 2. Identify date(s) in current session
      const datesInSession = new Set<string>();
      rekonResult.cocok.forEach(r => datesInSession.add(r.sys.tanggal));
      rekonResult.hanyaDiSistem.forEach(r => datesInSession.add(r.tanggal));
      rekonResult.hanyaDiBank.forEach(r => datesInSession.add(r.tanggal));

      // 3. Identify indices to delete (Outstanding/Unbooked for same date and bank)
      // This implements the "replace all" logic for these statuses
      const indicesToDelete: number[] = [];
      if (allData) {
        for (let i = 1; i < allData.length; i++) {
          const row = allData[i];
          const rowDate = row[0];
          const rowBank = row[2];
          const rowStatus = row[7];
          
          if (datesInSession.has(rowDate) && rowBank === bank && (rowStatus === 'Outstanding Sistem' || rowStatus === 'Belum Dibukukan')) {
            indicesToDelete.push(i);
          }
        }
      }

      // 4. Delete those rows first
      if (indicesToDelete.length > 0) {
        setLoadingMessage(`Menghapus ${indicesToDelete.length} data lama...`);
        await googleSheetsService.deleteRows(spreadsheetId, sheetId, indicesToDelete);
        // Re-read data after deletion to get correct indices for updates/inserts
        allData = await googleSheetsService.readData(spreadsheetId, 'RekonData!A:J');
      }

      const updates: { range: string, values: any[][] }[] = [];
      const toAppend: any[][] = [];
      
      // Prepare the new data items
      const newItems = [
        ...rekonResult.cocok.map(r => ({
          tanggal: r.sys.tanggal,
          keterangan: r.sys.keterangan,
          bank: bank,
          cabang: r.sys.cabang,
          nominalSistem: r.sys.nominalNormal,
          nominalBank: r.bnk.nominalNormal,
          selisih: 0,
          status: 'Matched',
          kategori: r.sys.kategori,
          catatan: ''
        })),
        ...rekonResult.hanyaDiSistem.map(r => ({
          tanggal: r.tanggal,
          keterangan: r.keterangan,
          bank: bank,
          cabang: r.cabang,
          nominalSistem: r.nominalNormal,
          nominalBank: 0,
          selisih: r.nominalNormal,
          status: 'Outstanding Sistem',
          kategori: r.kategori,
          catatan: r.catatan || ''
        })),
        ...rekonResult.hanyaDiBank.map(r => ({
          tanggal: r.tanggal,
          keterangan: r.keterangan,
          bank: bank,
          cabang: r.cabang,
          nominalSistem: 0,
          nominalBank: r.nominalNormal,
          selisih: -r.nominalNormal,
          status: 'Belum Dibukukan',
          kategori: r.kategori,
          catatan: r.catatan || ''
        }))
      ];

      // Find last matched row index for insertion if needed
      let lastMatchedIndex = 0;
      if (allData) {
        for (let i = 0; i < allData.length; i++) {
          if (allData[i][7] === 'Matched') {
            lastMatchedIndex = i;
          }
        }
      }

      for (const item of newItems) {
        let foundIndex = -1;
        
        // Only check for duplicates if it's "Matched"
        if (item.status === 'Matched' && allData) {
          for (let i = 1; i < allData.length; i++) {
            const row = allData[i];
            const matchDate = row[0] === item.tanggal;
            const matchCabang = row[3] === item.cabang;
            const matchBank = row[2] === item.bank;
            const matchStatus = row[7] === 'Matched';
            
            // Check nominal match
            const rowNominalSistem = Math.abs(parseFloat(String(row[4]).replace(/[^0-9.-]+/g,"")) || 0);
            const rowNominalBank = Math.abs(parseFloat(String(row[5]).replace(/[^0-9.-]+/g,"")) || 0);
            const itemNominal = Math.abs(item.nominalSistem || item.nominalBank);
            
            const matchNominal = Math.abs(rowNominalSistem - itemNominal) < 1 || Math.abs(rowNominalBank - itemNominal) < 1;

            if (matchDate && matchCabang && matchBank && matchStatus && matchNominal) {
              foundIndex = i;
              break;
            }
          }
        }

        const rowValues = [
          item.tanggal, item.keterangan, item.bank, item.cabang, 
          item.nominalSistem, item.nominalBank, item.selisih, 
          item.status, item.kategori, item.catatan
        ];

        if (foundIndex !== -1) {
          updates.push({
            range: `RekonData!A${foundIndex + 1}:J${foundIndex + 1}`,
            values: [rowValues]
          });
        } else {
          toAppend.push(rowValues);
        }
      }

      // Execute updates
      if (updates.length > 0) {
        setLoadingMessage(`Memperbarui ${updates.length} data...`);
        await googleSheetsService.batchUpdateValues(spreadsheetId, updates);
      }

      // Execute appends
      if (toAppend.length > 0) {
        // Separate Matched and others for "insert at bottom of Matched" logic
        const matchedToAppend = toAppend.filter(row => row[7] === 'Matched');
        const othersToAppend = toAppend.filter(row => row[7] !== 'Matched');

        if (matchedToAppend.length > 0) {
          setLoadingMessage(`Menambahkan ${matchedToAppend.length} data Matched...`);
          if (lastMatchedIndex > 0) {
            // Insert after the last matched row
            await googleSheetsService.insertRows(spreadsheetId, sheetId, lastMatchedIndex + 1, matchedToAppend.length);
            await googleSheetsService.updateData(spreadsheetId, `RekonData!A${lastMatchedIndex + 2}`, matchedToAppend);
          } else {
            // No matched rows yet, insert after header (row 2)
            await googleSheetsService.insertRows(spreadsheetId, sheetId, 1, matchedToAppend.length);
            await googleSheetsService.updateData(spreadsheetId, `RekonData!A2`, matchedToAppend);
          }
        }

        if (othersToAppend.length > 0) {
          setLoadingMessage(`Menambahkan ${othersToAppend.length} data Outstanding...`);
          await googleSheetsService.appendData(spreadsheetId, 'RekonData!A1', othersToAppend);
        }
      }

      toast.success('Data berhasil disimpan ke Google Sheets');
    } catch (error: any) {
      console.error('Error saving to Google Sheets:', error);
      toast.error(`Gagal menyimpan: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Renders ---
  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Rekonsiliasi Bank {bank}</h1>
          <p className="text-sm text-gray-500 mt-1">Proses pencocokan data mutasi CMS Bank {bank} dengan Sistem Internal.</p>
        </div>
        
        {!isGoogleConnected ? (
          <button 
            onClick={handleConnectGoogle}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-red-600 font-bold">[WAJIB]</span> Hubungkan Google Sheet
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100 text-xs font-medium">
            <CheckCircle className="w-4 h-4" />
            Terhubung ke Google Sheets
          </div>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-4 mb-6">
        <div className={`flex items-center gap-2 ${step >= 1 ? 'text-[#009B4F]' : 'text-gray-400'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step >= 1 ? 'bg-[#009B4F] text-white' : 'bg-gray-200'}`}>1</div>
          <span className="font-medium">Upload File</span>
        </div>
        <div className={`h-px w-12 ${step >= 2 ? 'bg-[#009B4F]' : 'bg-gray-300'}`}></div>
        <div className={`flex items-center gap-2 ${step >= 2 ? 'text-[#009B4F]' : 'text-gray-400'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step >= 2 ? 'bg-[#009B4F] text-white' : 'bg-gray-200'}`}>2</div>
          <span className="font-medium">Review Data Rekon</span>
        </div>
        <div className={`h-px w-12 ${step >= 3 ? 'bg-[#009B4F]' : 'bg-gray-300'}`}></div>
        <div className={`flex items-center gap-2 ${step >= 3 ? 'text-[#009B4F]' : 'text-gray-400'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step >= 3 ? 'bg-[#009B4F] text-white' : 'bg-gray-200'}`}>3</div>
          <span className="font-medium">Hasil Rekon</span>
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="flex-1 grid grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-[#009B4F]/10 rounded-full flex items-center justify-center mb-4 text-[#009B4F]">
              <FileSpreadsheet className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Upload Data Sistem</h3>
            <p className="text-sm text-gray-500 mb-6">Pilih file Excel dari Sistem Internal (format .xlsx)</p>
            <label className="bg-[#009B4F] hover:bg-[#008543] text-white px-6 py-2.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Pilih File Sistem
              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={(e) => handleFileUpload(e, 'sistem')} />
            </label>
            {sistemFile && (
              <div className="mt-4 flex items-center gap-2 text-sm text-[#009B4F] bg-[#009B4F]/10 px-4 py-2 rounded-lg">
                <CheckCircle className="w-4 h-4" />
                {sistemFile.name} ({sistemData.length} baris)
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-[#C4D600]/20 rounded-full flex items-center justify-center mb-4 text-[#8A9A00]">
              <FileSpreadsheet className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Upload Data CMS Bank</h3>
            <p className="text-sm text-gray-500 mb-6">Pilih file Excel dari Mutasi CMS {bank} (format .xlsx)</p>
            <label className="bg-[#C4D600] hover:bg-[#A8B800] text-gray-800 px-6 py-2.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Pilih File Bank
              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={(e) => handleFileUpload(e, 'bank')} />
            </label>
            {bankFile && (
              <div className="mt-4 flex items-center gap-2 text-sm text-[#8A9A00] bg-[#C4D600]/20 px-4 py-2 rounded-lg">
                <CheckCircle className="w-4 h-4" />
                {bankFile.name} ({bankData.length} baris)
              </div>
            )}
          </div>

          <div className="col-span-2 flex justify-end mt-4">
            <button 
              onClick={handleLanjutReview}
              disabled={!sistemFile || !bankFile}
              className={`px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${sistemFile && bankFile ? 'bg-[#009B4F] hover:bg-[#008543] text-white shadow-md shadow-[#009B4F]/20 cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              Lanjut Review Data Rekon
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-gray-800">Review Data Rekon</h3>
              <p className="text-sm text-gray-500">Periksa data sistem dan mutasi bank. Pastikan cabang dan kategori sudah sesuai.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors cursor-pointer">
                Kembali
              </button>
              <button onClick={handleProsesRekon} className="bg-[#009B4F] hover:bg-[#008543] text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors shadow-sm shadow-[#009B4F]/20 cursor-pointer">
                <Play className="w-4 h-4" />
                Proses Rekon
              </button>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 divide-x divide-gray-100 overflow-hidden">
            {/* Sistem Table */}
            <div className="flex flex-col overflow-hidden">
              <div className="p-3 bg-[#009B4F]/5 border-b border-gray-100 font-bold text-[#009B4F] text-center">Data Sistem/Outstanding ({sistemData.length} baris)</div>
              <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white shadow-sm z-10">
                    <tr>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[80px]">Tanggal</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[200px]">Keterangan</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold text-right resize-x overflow-hidden min-w-[100px]">Nominal</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[150px]">Cabang</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[120px]">Kategori</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sistemData.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="py-2 px-3 whitespace-nowrap">{row.tanggal}</td>
                        <td className="py-2 px-3 min-w-[250px] break-words whitespace-normal">{row.keterangan}</td>
                        <td className="py-2 px-3 text-right font-medium">{formatCurrency(row.nominalNormal)}</td>
                        <td className="py-1 px-3">
                          <Select
                            options={cabangOptions}
                            value={cabangOptions.find(c => c.value === row.cabang) || { value: row.cabang, label: row.cabang }}
                            onChange={(opt) => handleCabangChange(row.id, opt?.value || '', 'sistem')}
                            onInputChange={(val) => {
                              if (val) handleCabangChange(row.id, val, 'sistem');
                            }}
                            isSearchable
                            className="text-sm"
                            styles={{
                              control: (base) => ({
                                ...base,
                                minHeight: '30px',
                                borderColor: isCabangValid(row.cabang) ? '#10b981' : '#ef4444',
                                borderWidth: '2px',
                                '&:hover': {
                                  borderColor: isCabangValid(row.cabang) ? '#059669' : '#dc2626',
                                }
                              }),
                              valueContainer: (base) => ({ ...base, padding: '0 8px' }),
                              input: (base) => ({ ...base, margin: '0' }),
                            }}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${row.kategori === 'Non Pembayaran' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {row.kategori}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bank Table */}
            <div className="flex flex-col overflow-hidden">
              <div className="p-3 bg-[#C4D600]/10 border-b border-gray-100 font-bold text-[#8A9A00] text-center">Data CMS/Belum Dibukukan ({bankData.length} baris)</div>
              <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white shadow-sm z-10">
                    <tr>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[80px]">Tanggal</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[200px]">Keterangan</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold text-right resize-x overflow-hidden min-w-[100px]">Nominal</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[150px]">Cabang</div>
                      </th>
                      <th className="p-0 border-b border-r border-gray-100 last:border-r-0 bg-white">
                        <div className="py-2 px-3 text-gray-500 font-semibold resize-x overflow-hidden min-w-[120px]">Kategori</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {bankData.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="py-2 px-3 whitespace-nowrap">{row.tanggal}</td>
                        <td className="py-2 px-3 min-w-[250px] break-words whitespace-normal">{row.keterangan}</td>
                        <td className="py-2 px-3 text-right font-medium">{formatCurrency(row.nominalNormal)}</td>
                        <td className="py-1 px-3">
                          <Select
                            options={cabangOptions}
                            value={cabangOptions.find(c => c.value === row.cabang) || { value: row.cabang, label: row.cabang }}
                            onChange={(opt) => handleCabangChange(row.id, opt?.value || '', 'bank')}
                            onInputChange={(val) => {
                              if (val) handleCabangChange(row.id, val, 'bank');
                            }}
                            isSearchable
                            className="text-sm"
                            styles={{
                              control: (base) => ({
                                ...base,
                                minHeight: '30px',
                                borderColor: isCabangValid(row.cabang) ? '#10b981' : '#ef4444',
                                borderWidth: '2px',
                                '&:hover': {
                                  borderColor: isCabangValid(row.cabang) ? '#059669' : '#dc2626',
                                }
                              }),
                              valueContainer: (base) => ({ ...base, padding: '0 8px' }),
                              input: (base) => ({ ...base, margin: '0' }),
                            }}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${row.kategori === 'Non Pembayaran' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {row.kategori}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Result */}
      {step === 3 && rekonResult && (
        <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-gray-800">Hasil Rekonsiliasi</h3>
              <p className="text-sm text-gray-500">Hasil pencocokan data mutasi CMS Bank {bank} dengan Sistem Internal.</p>
            </div>
            <div className="flex gap-3">
              <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <button onClick={exportToExcel} className="px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2 text-xs font-bold border-r border-gray-100 cursor-pointer">
                  <Download className="w-4 h-4 text-emerald-600" />
                  Excel
                </button>
                <button onClick={exportToPDF} className="px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2 text-xs font-bold border-r border-gray-100 cursor-pointer">
                  <FileText className="w-4 h-4 text-red-600" />
                  PDF
                </button>
                <button onClick={saveToGoogleSheet} className="px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2 text-xs font-bold cursor-pointer">
                  <Database className="w-4 h-4 text-blue-600" />
                  Save to Sheets
                </button>
              </div>
              <button onClick={() => setStep(2)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors cursor-pointer">
                Kembali
              </button>
              <button 
                onClick={() => {
                  setStep(1);
                  setSistemFile(null);
                  setBankFile(null);
                  setSistemData([]);
                  setBankData([]);
                  setRekonResult(null);
                }}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Mulai Baru
              </button>
            </div>
          </div>
          <div className="flex border-b border-gray-100">
            <button 
              onClick={() => setActiveTabResult('cocok')}
              className={`flex-1 py-4 font-bold text-sm transition-colors cursor-pointer ${activeTabResult === 'cocok' ? 'bg-[#009B4F]/10 text-[#009B4F] border-b-2 border-[#009B4F]' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              ✅ DATA MATCHED ({rekonResult.cocok.length})
            </button>
            <button 
              onClick={() => setActiveTabResult('sistem')}
              className={`flex-1 py-4 font-bold text-sm transition-colors cursor-pointer ${activeTabResult === 'sistem' ? 'bg-red-50 text-red-600 border-b-2 border-red-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              ❌ DATA SISTEM/OUTSTANDING ({rekonResult.hanyaDiSistem.length})
            </button>
            <button 
              onClick={() => setActiveTabResult('bank')}
              className={`flex-1 py-4 font-bold text-sm transition-colors cursor-pointer ${activeTabResult === 'bank' ? 'bg-orange-50 text-orange-600 border-b-2 border-orange-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              ⚠️ DATA CMS/BELUM DIBUKUKAN ({rekonResult.hanyaDiBank.length})
            </button>
            <button 
              onClick={() => setActiveTabResult('analisa')}
              className={`flex-1 py-4 font-bold text-sm transition-colors cursor-pointer ${activeTabResult === 'analisa' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              📊 ANALISA
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
            {activeTabResult === 'cocok' && (
              <table className="w-full text-left text-sm border border-gray-200">
                <thead className="bg-[#009B4F]/10 text-[#009B4F]">
                  <tr>
                    <th className="py-3 px-4 border-b border-gray-200">Tanggal</th>
                    <th className="py-3 px-4 border-b border-gray-200">Ket. Sistem</th>
                    <th className="py-3 px-4 border-b border-gray-200 text-right">Nominal Sistem</th>
                    <th className="py-3 px-4 border-b border-gray-200">Cabang Sistem</th>
                    <th className="py-3 px-4 border-b border-gray-200">Ket. Bank</th>
                    <th className="py-3 px-4 border-b border-gray-200 text-right">Nominal Bank</th>
                    <th className="py-3 px-4 border-b border-gray-200">Cabang Bank</th>
                    <th className="py-3 px-4 border-b border-gray-200">Kategori</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rekonResult.cocok.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="py-2 px-4">{row.sys.tanggal}</td>
                      <td className="py-2 px-4 min-w-[200px] break-words whitespace-normal">{row.sys.keterangan}</td>
                      <td className="py-2 px-4 text-right font-medium">{formatCurrency(row.sys.nominalNormal)}</td>
                      <td className="py-2 px-4 font-medium text-[#009B4F]">{row.sys.cabang}</td>
                      <td className="py-2 px-4 min-w-[200px] break-words whitespace-normal">{row.bnk.keterangan}</td>
                      <td className="py-2 px-4 text-right font-medium">{formatCurrency(row.bnk.nominalNormal)}</td>
                      <td className="py-2 px-4 font-medium text-[#8A9A00]">{row.bnk.cabang}</td>
                      <td className="py-2 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${row.sys.kategori === 'Non Pembayaran' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {row.sys.kategori}
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td colSpan={2} className="py-3 px-4 text-right">TOTAL COCOK</td>
                    <td className="py-3 px-4 text-right text-[#009B4F]">{formatCurrency(rekonResult.cocok.reduce((s, r) => s + r.sys.nominalNormal, 0))}</td>
                    <td colSpan={2} className="py-3 px-4 text-right">TOTAL COCOK</td>
                    <td className="py-3 px-4 text-right text-[#8A9A00]">{formatCurrency(rekonResult.cocok.reduce((s, r) => s + r.bnk.nominalNormal, 0))}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            )}

            {activeTabResult === 'sistem' && (
              <table className="w-full text-left text-sm border border-gray-200">
                <thead className="bg-red-50 text-red-600">
                  <tr>
                    <th className="py-3 px-4 border-b border-gray-200">Tanggal</th>
                    <th className="py-3 px-4 border-b border-gray-200">Keterangan</th>
                    <th className="py-3 px-4 border-b border-gray-200 text-right">Nominal</th>
                    <th className="py-3 px-4 border-b border-gray-200">Cabang</th>
                    <th className="py-3 px-4 border-b border-gray-200">Kategori</th>
                    <th className="py-3 px-4 border-b border-gray-200">Catatan Rekon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rekonResult.hanyaDiSistem.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="py-2 px-4">{row.tanggal}</td>
                      <td className="py-2 px-4">{row.keterangan}</td>
                      <td className="py-2 px-4 text-right font-medium text-red-600">{formatCurrency(row.nominalNormal)}</td>
                      <td className="py-2 px-4 font-medium">{row.cabang}</td>
                      <td className="py-2 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${row.kategori === 'Non Pembayaran' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {row.kategori}
                        </span>
                      </td>
                      <td className="py-1 px-4">
                        <input 
                          type="text" 
                          placeholder="Tambah catatan..."
                          value={row.catatan || ''}
                          onChange={(e) => handleCatatanChange(row.id, e.target.value, 'sistem')}
                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:border-red-500 outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-red-50/50 font-bold">
                    <td colSpan={2} className="py-3 px-4 text-right">TOTAL OUTSTANDING</td>
                    <td className="py-3 px-4 text-right text-red-600">{formatCurrency(rekonResult.analisa.totalOutstanding)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tbody>
              </table>
            )}

            {activeTabResult === 'bank' && (
              <table className="w-full text-left text-sm border border-gray-200">
                <thead className="bg-orange-50 text-orange-600">
                  <tr>
                    <th className="py-3 px-4 border-b border-gray-200">Tanggal</th>
                    <th className="py-3 px-4 border-b border-gray-200">Keterangan</th>
                    <th className="py-3 px-4 border-b border-gray-200 text-right">Nominal</th>
                    <th className="py-3 px-4 border-b border-gray-200">Cabang</th>
                    <th className="py-3 px-4 border-b border-gray-200">Kategori</th>
                    <th className="py-3 px-4 border-b border-gray-200">Catatan Rekon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rekonResult.hanyaDiBank.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="py-2 px-4">{row.tanggal}</td>
                      <td className="py-2 px-4">{row.keterangan}</td>
                      <td className="py-2 px-4 text-right font-medium text-orange-600">{formatCurrency(row.nominalNormal)}</td>
                      <td className="py-2 px-4 font-medium">{row.cabang}</td>
                      <td className="py-2 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${row.kategori === 'Non Pembayaran' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {row.kategori}
                        </span>
                      </td>
                      <td className="py-1 px-4">
                        <input 
                          type="text" 
                          placeholder="Tambah catatan..."
                          value={row.catatan || ''}
                          onChange={(e) => handleCatatanChange(row.id, e.target.value, 'bank')}
                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:border-orange-500 outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-orange-50/50 font-bold">
                    <td colSpan={2} className="py-3 px-4 text-right">TOTAL BELUM DIBUKUKAN</td>
                    <td className="py-3 px-4 text-right text-orange-600">{formatCurrency(rekonResult.analisa.totalBelumDibukukan)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tbody>
              </table>
            )}

            {activeTabResult === 'analisa' && (
              <div className="max-w-2xl mx-auto mt-8">
                <div className="bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-blue-50 px-6 py-4 border-b border-blue-200">
                    <h3 className="text-lg font-bold text-blue-800">📊 Analisa Rekonsiliasi</h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-600">1. Balance Akhir RC (Bank)</span>
                      <span className="font-bold text-gray-800">{formatCurrency(rekonResult.analisa.balanceAkhirBank)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-600">2. Balance Akhir Sistem</span>
                      <span className="font-bold text-gray-800">{formatCurrency(rekonResult.analisa.balanceAkhirSistem)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-600">3. {rekonResult.analisa.selisihRCSistem >= 0 ? 'Selisih Lebih' : 'Selisih Kurang'}</span>
                      <span className={`font-bold ${rekonResult.analisa.selisihRCSistem === 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(rekonResult.analisa.selisihRCSistem)}
                      </span>
                    </div>
                    
                    <div className="pt-4">
                      <span className="font-bold text-gray-800 mb-2 block">4. Penjelasan Selisih:</span>
                      <div className="pl-6 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">a. Balance Akhir Sistem</span>
                          <span className="font-medium">{formatCurrency(rekonResult.analisa.balanceAkhirSistem)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">b. Belum dibukukan (Hanya di Bank)</span>
                          <span className="font-medium text-orange-600">{formatCurrency(rekonResult.analisa.totalBelumDibukukan)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">c. Uang belum masuk (Hanya di Sistem)</span>
                          <span className="font-medium text-red-600">{formatCurrency(rekonResult.analisa.totalOutstanding)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                          <span className="font-medium text-gray-800">d. Selisih (b - c)</span>
                          <span className="font-bold">{formatCurrency(rekonResult.analisa.selisihNetto)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center p-4 mt-6 bg-[#C4D600]/20 rounded-lg border border-[#C4D600]/50">
                      <span className="font-bold text-[#005245]">5. Seharusnya Balance Akhir Sistem (a + d)</span>
                      <span className="font-bold text-xl text-[#005245]">{formatCurrency(rekonResult.analisa.seharusnyaBalance)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
