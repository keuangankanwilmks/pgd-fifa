import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight, Save, Play, RefreshCw, X, Download, FileText, Database } from 'lucide-react';
import * as XLSX from 'xlsx';
import Select from 'react-select';
import toast from 'react-hot-toast';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { googleSheetsService } from '../services/googleSheetsService';
import { useNotifications } from '../contexts/NotificationContext';

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
  
  const str = String(excelDate).trim();
  if (str === "") return "";
  
  // 1. Check if it's DD/MM/YYYY or DD.MM.YYYY (common Indonesian format)
  // We prioritize this to handle BNI CMS strings like "06/04/2026 06.03.32"
  const dmyMatch = str.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{2,4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    let year = dmyMatch[3].split(' ')[0];
    if (year.length === 2) year = "20" + year;
    if (year.length > 4) year = year.substring(0, 4);
    return `${year}-${month}-${day}`;
  }

  // 2. Check if it's already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // 3. Handle numeric Excel serial dates
  if (typeof excelDate === 'number' || /^\d+(\.\d+)?$/.test(str)) {
    const num = typeof excelDate === 'number' ? excelDate : parseFloat(str);
    if (!isNaN(num) && num > 25569) {
      const date = new Date(Math.round((num - 25569) * 86400 * 1000));
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 4. Handle Date objects
  if (excelDate instanceof Date) {
    const year = excelDate.getFullYear();
    const month = String(excelDate.getMonth() + 1).padStart(2, '0');
    const day = String(excelDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
  const [hasDateInconsistency, setHasDateInconsistency] = useState(false);
  const { addNotification } = useNotifications();

  const fetchCabang = async () => {
    try {
      // 1. Fetch from Firestore (Primary)
      const firestoreCabang = await cabangService.getAll();
      if (firestoreCabang.length > 0) {
        setCabangOptions(firestoreCabang.map(c => ({ value: c.nama, label: c.nama })));
      }
      
      // 2. Fallback/Supplement from Google Sheets when spreadsheet access is configured.
      const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
      if (spreadsheetId) {
        try {
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
        } catch (sheetError) {
          console.warn('Tidak dapat memuat data cabang dari Google Sheets:', sheetError);
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
    fetchCabang();
  }, []);
  
  const [sistemData, setSistemData] = useState<SistemData[]>([]);
  const [bankData, setBankData] = useState<BankData[]>([]);

  useEffect(() => {
    const checkDateConsistency = () => {
      if (sistemData.length > 0 && bankData.length > 0) {
        const sistemDate = sistemData[0].tanggal;
        const bankDate = bankData[0].tanggal;
        
        if (sistemDate !== bankDate) {
          setHasDateInconsistency(true);
          toast.error(
            `Peringatan: Inconsistency Tanggal! Tanggal Data Sistem (${sistemDate}) dan Data CMS (${bankDate}) tidak sama.`,
            { duration: 10000, id: 'date-inconsistency-rekon' }
          );
        } else {
          setHasDateInconsistency(false);
        }
      } else {
        setHasDateInconsistency(false);
      }
    };

    checkDateConsistency();
  }, [sistemData, bankData]);
  
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
        const wb = XLSX.read(new Uint8Array(arrayBuffer as ArrayBuffer), { type: 'array', cellNF: true, raw: true });
        
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
        
        // Use raw: false and dateNF to get unambiguous strings
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
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
      let textUtama = String(row[4] || "").trim();
      const longText = String(row[11] || "").trim();
      const debit = cleanAmount(row[7]);
      const kredit = cleanAmount(row[8]);
      const balance = cleanAmount(row[9]);
      
      let keteranganFinal = textUtama !== "" ? textUtama : longText;
      const tglCek = String(tanggalRaw || "").toLowerCase();
      
      if (tanggalRaw && String(tanggalRaw).trim() !== "" && 
          !/saldo awal|mutasi debit|mutasi kredit|saldo akhir|jumlah mutasi/i.test(tglCek) &&
          !/saldo awal|mutasi debit|mutasi kredit|saldo akhir|jumlah mutasi/i.test(keteranganFinal)) {
        
        // Look-ahead for multi-line descriptions in system data
        let j = i + 1;
        while (j < data.length) {
          const nextRow = data[j];
          if (!nextRow) break;
          const nextTgl = String(nextRow[0] || "").trim();
          const nextKetUtama = String(nextRow[4] || "").trim();
          const nextLongText = String(nextRow[11] || "").trim();
          
          if (nextTgl === "" && (nextKetUtama !== "" || nextLongText !== "")) {
            const nextKet = nextKetUtama !== "" ? nextKetUtama : nextLongText;
            if (!/saldo awal|mutasi debit|mutasi kredit|saldo akhir|jumlah mutasi/i.test(nextKet)) {
              keteranganFinal += " " + nextKet;
            }
            j++;
          } else {
            break;
          }
        }

        let namaCabang = getCabang(keteranganFinal, false);
        
        if (namaCabang === "-") {
          const regex = /(CP|CPS|UPS|UPC)\s+([A-Z\s]+?)(?=\s+\d|\s*\||\s*-$|$)/i;
          const match = keteranganFinal.match(regex);
          if (match) {
            namaCabang = `${match[1].toUpperCase()} ${match[2].trim().toUpperCase()}`;
          }
        }

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

        i = j - 1;
      }
    }
    setSistemData(result);
  };

  const getCabang = (keterangan: string, isBankData: boolean = false) => {
    if (!keterangan) return "-";
    let ketUpper = keterangan.toUpperCase();
    
    // Rule 4: Special Case CPS LUWU
    if (ketUpper.includes("CPS LUWU")) return "CPS L U W U";

    // Rule 2: BNI Logic (if keterangan contain | TRF, then use text before)
    if (ketUpper.includes("| TRF")) {
      ketUpper = ketUpper.split("| TRF")[0].trim();
    }

    // Clean version for numeric matching (remove spaces, dots, commas, etc)
    const ketClean = ketUpper.replace(/[^A-Z0-9]/g, '');
    
    // Priority 1: CPS or SYA
    const preferCPS = ketUpper.includes("CPS") || ketUpper.includes("SYA");
    // Priority 2: CP, CABANG, CAB.
    const preferCP = ketUpper.includes("CP") || ketUpper.includes("CABANG") || ketUpper.includes("CAB.");

    // Special Logic for BRI Bank/CMS Data (Priority 3)
    if (bank === 'BRI' && isBankData) {
      let extracted = ketUpper;
      if (ketUpper.includes("CMSPOOL") && ketUpper.includes(" TO ")) {
        const parts = ketUpper.split("CMSPOOL");
        if (parts.length > 1) {
          extracted = parts[1].split(" TO ")[0].trim();
        }
      } else if (ketUpper.includes(" TO ")) {
        extracted = ketUpper.split(" TO ")[0].trim();
      } else if (ketUpper.includes("CMSPOOL")) {
        const parts = ketUpper.split("CMSPOOL");
        if (parts.length > 1) {
          extracted = parts[1].trim();
        }
      }

      // Rule 3: If text contain "KANWIL", then value with a dash ("-")
      if (extracted.includes("KANWIL")) return "-";

      if (extracted.length >= 3) {
        // Sort mappings by keterangan length descending to find most specific match
        const sortedForBRI = [...norekMappings].sort((a, b) => b.keterangan.length - a.keterangan.length);
        for (const mapping of sortedForBRI) {
          const mapKet = mapping.keterangan.toUpperCase();
          const targetCabang = mapping.namaCabang.toUpperCase();
          
          // Priority 1 & 2 constraints
          const isCPS = targetCabang.startsWith("CPS");
          const isUPS = targetCabang.startsWith("UPS");
          const isCP = targetCabang.startsWith("CP") && !isCPS && !isUPS;

          if (preferCPS && !isCPS) continue;
          if (!preferCPS && preferCP && (isCPS || isUPS)) continue;

          // Match logic: substring match or word-based prefix match
          let matched = false;
          if (mapKet.includes(extracted) || extracted.includes(mapKet)) {
            matched = true;
          } else {
            const cmsWords = extracted.split(/\s+/).filter(w => w.length >= 3);
            const mapWords = mapKet.split(/\s+/).filter(w => w.length >= 3);
            if (cmsWords.length > 0 && mapWords.length > 0) {
              matched = mapWords.every(mWord => 
                cmsWords.some(cWord => mWord.startsWith(cWord) || cWord.startsWith(mWord))
              );
            }
          }
          
          if (matched) {
            return mapping.namaCabang;
          }
        }
      }
    }
    
    // 1. Priority: Direct match from Firestore norek_mapping (keterangan field)
    // Sort by keyword length descending to handle longest match first
    const sortedMappingsByKeterangan = [...norekMappings].sort((a, b) => b.keterangan.length - a.keterangan.length);

    const tryMatch = (pCPS: boolean, pCP: boolean) => {
      for (const mapping of sortedMappingsByKeterangan) {
        const keyword = mapping.keterangan.toUpperCase().trim();
        const namaCabang = mapping.namaCabang.trim();
        const targetCabangUpper = namaCabang.toUpperCase();
        
        if (keyword === "" || namaCabang === "") continue;

        // Apply priority logic
        const isCPS = targetCabangUpper.startsWith("CPS");
        const isUPS = targetCabangUpper.startsWith("UPS");
        const isCP = targetCabangUpper.startsWith("CP") && !isCPS && !isUPS;

        if (pCPS && !isCPS) continue;
        if (!pCPS && pCP && (isCPS || isUPS)) continue;

        // Robust matching for account numbers (mostly digits)
        const kwClean = keyword.replace(/[^A-Z0-9]/g, '');
        if (/^\d+$/.test(kwClean) && kwClean.length >= 5) {
          if (ketClean.indexOf(kwClean) !== -1) {
            return mapping.namaCabang;
          }
        }

        // Standard substring matching
        if (ketUpper.indexOf(keyword) !== -1) {
          return mapping.namaCabang; 
        }
      }
      return null;
    };

    // First try with preference
    let result = tryMatch(preferCPS, preferCP);
    if (result) return result;

    // Fallback try without preference
    for (const mapping of sortedMappingsByKeterangan) {
      const keyword = mapping.keterangan.toUpperCase().trim();
      if (keyword === "") continue;
      const kwClean = keyword.replace(/[^A-Z0-9]/g, '');
      if (/^\d+$/.test(kwClean) && kwClean.length >= 5) {
        if (ketClean.indexOf(kwClean) !== -1) return mapping.namaCabang;
      }
      if (ketUpper.indexOf(keyword) !== -1) return mapping.namaCabang;
    }

    // 2. Advanced Keyword Detection: "CABANG", "CAB.", "CP", "CPS", "UPS", "UPC", "PERUM PEGADAIAN"
    const regex = /(?:CABANG|CAB\.|CP|CPS|UPS|UPC|PERUM PEGADAIAN)\s+([A-Z0-9\s\.\-]+)/i;
    const match = ketUpper.match(regex);
    
    if (match && match[1]) {
      // Clean up the extracted text and get the words
      const extractedText = match[1].trim();
      const words = extractedText.split(/\s+/);
      
      // Sort mappings by namaCabang length descending to handle longest match first
      const sortedMappingsByNama = [...norekMappings].sort((a, b) => b.namaCabang.length - a.namaCabang.length);

      // Try matching the full extracted text first (up to 3 words)
      for (let len = Math.min(words.length, 3); len >= 1; len--) {
        const phrase = words.slice(0, len).join(" ").replace(/[^A-Z0-9\s]/g, '').trim();
        if (phrase.length < 3) continue;

        for (const mapping of sortedMappingsByNama) {
          const targetCabang = mapping.namaCabang.toUpperCase();
          const isCPS = targetCabang.startsWith("CPS");
          const isUPS = targetCabang.startsWith("UPS");
          const isCP = targetCabang.startsWith("CP") && !isCPS && !isUPS;

          if (preferCPS && !isCPS) continue;
          if (!preferCPS && preferCP && (isCPS || isUPS)) continue;

          if (targetCabang.includes(phrase) || phrase.includes(targetCabang)) {
            return mapping.namaCabang;
          }
        }
      }
      
      // If no match in Firestore, format it as "CP [PHRASE]" or "CPS [PHRASE]" as a best guess
      // Take up to 2 words for the best guess
      const bestGuessPhrase = words.slice(0, 2).join(" ").replace(/[^A-Z0-9\s]/g, '').trim();
      if (bestGuessPhrase.length >= 3) {
        return (preferCPS ? "CPS " : "CP ") + bestGuessPhrase;
      }
    }
    
    // 3. Final Fallback: Check if any part of the keterangan matches a namaCabang directly
    const sortedMappingsByNamaFinal = [...norekMappings].sort((a, b) => b.namaCabang.length - a.namaCabang.length);
    for (const mapping of sortedMappingsByNamaFinal) {
      const targetCabang = mapping.namaCabang.toUpperCase();
      if (targetCabang.length > 3 && ketUpper.includes(targetCabang)) {
        const isCPS = targetCabang.startsWith("CPS");
        const isUPS = targetCabang.startsWith("UPS");
        const isCP = targetCabang.startsWith("CP") && !isCPS && !isUPS;

        if (preferCPS && !isCPS) continue;
        if (!preferCPS && preferCP && (isCPS || isUPS)) continue;
        
        return mapping.namaCabang;
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
        
        const namaCabang = getCabang(ket, true);
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
      let ket = String(row[2] || "").trim(); // Col C
      const amountRaw = row[4]; // Col E
      const dbRaw = String(row[5] || "").trim().toUpperCase(); // Col F
      const crRaw = String(row[6] || "").trim().toUpperCase(); // Col G
      const balanceRaw = row[7]; // Col H

      const amount = cleanAmount(amountRaw);
      const balance = cleanAmount(balanceRaw);
      
      if (tanggalRaw && amount > 0) {
        // Look-ahead for BSI
        let j = i + 1;
        while (j < data.length) {
          const nextRow = data[j];
          if (!nextRow) break;
          const nextTgl = String(nextRow[0] || "").trim();
          const nextKet = String(nextRow[2] || "").trim();
          
          if (nextTgl === "" && nextKet !== "") {
            if (!/halaman|page|saldo awal|opening balance/i.test(nextKet)) {
              ket += " " + nextKet;
            }
            j++;
          } else {
            break;
          }
        }

        let dcFinal = "";
        if (dbRaw === "DB") dcFinal = "D";
        else if (crRaw === "CR") dcFinal = "C";
        
        const namaCabang = getCabang(ket, true);
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

        i = j - 1;
      }
    }
    console.log('Finished parseBankBSI. Found valid rows:', result.length);
    setBankData(result);
  };

  const parseBank = (data: any[][]) => {
    const result: BankData[] = [];
    let startRow = 0;
    // Default indices for BNI CMS
    const colIdx = { tanggal: 7, keterangan: 12, amount: 21, dc: 23, balance: 24 };

    // Find header row to be more dynamic
    for (let i = 0; i < Math.min(data.length, 25); i++) {
      const row = data[i];
      if (!row) continue;
      const rowStr = row.join(" ").toUpperCase();
      if ((rowStr.includes("POST DATE") || rowStr.includes("TANGGAL")) && 
          (rowStr.includes("DESCRIPTION") || rowStr.includes("KETERANGAN")) && 
          (rowStr.includes("AMOUNT") || rowStr.includes("NOMINAL"))) {
        startRow = i + 1;
        row.forEach((cell: any, idx: number) => {
          const val = String(cell || "").toUpperCase();
          if (val.includes("POST DATE") || val === "TGL" || val === "DATE") colIdx.tanggal = idx;
          if (val.includes("DESCRIPTION") || val.includes("KETERANGAN") || val.includes("REMARK")) colIdx.keterangan = idx;
          if (val.includes("AMOUNT") || val.includes("NOMINAL")) colIdx.amount = idx;
          if (val.includes("DB/CR") || val === "D/C") colIdx.dc = idx;
          if (val.includes("BALANCE") || val.includes("SALDO")) colIdx.balance = idx;
        });
        break;
      }
    }

    // If no header found, use default BNI CMS start row
    if (startRow === 0) startRow = 12;

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < Math.max(...Object.values(colIdx))) continue;
      
      const tanggalRaw = row[colIdx.tanggal];
      let ket = String(row[colIdx.keterangan] || "").trim();
      const amountRaw = row[colIdx.amount];
      const dcRaw = String(row[colIdx.dc] || "").trim().toUpperCase();
      const balance = cleanAmount(row[colIdx.balance]);
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
          const nextTgl = String(nextRow[colIdx.tanggal] || "").trim();
          const nextKet = String(nextRow[colIdx.keterangan] || "").trim();
          
          if (nextTgl === "" && nextKet !== "") {
            const isGarbage = /^(no\.|post date|branch|journal|description|amount|db\/cr|balance|page|post)/i.test(nextKet);
            if (!isGarbage) ket += " " + nextKet;
            j++;
          } else {
            break;
          }
        }
        
        ket = ket.replace(/\|/g, '').replace(/\s+/g, ' ').trim();
        const dcFinal = dcRaw.includes("D") ? "D" : (dcRaw.includes("C") ? "C" : "-");
        
        const namaCabang = getCabang(ket, true);
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
    if (hasDateInconsistency) {
      toast.error("Tidak dapat melanjutkan: Terdapat ketidakkonsistenan tanggal antar file!");
      return;
    }
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
        cocok.sort((a, b) => (a.sys.cabang || '').localeCompare(b.sys.cabang || ''));
        hanyaDiSistem.sort((a, b) => (a.cabang || '').localeCompare(b.cabang || ''));
        hanyaDiBank.sort((a, b) => (a.cabang || '').localeCompare(b.cabang || ''));

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
      addNotification(
        'Berhasil simpan data rekon',
        `Data rekonsiliasi Bank ${bank} berhasil disimpan ke Google Sheets.`,
        'success'
      );
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
        
        {/* Google Connection Button Removed */}
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
              disabled={!sistemFile || !bankFile || hasDateInconsistency}
              className={`px-8 py-4 rounded-xl font-bold flex items-center gap-2 transition-all ${sistemFile && bankFile && !hasDateInconsistency ? 'bg-[#009B4F] hover:bg-[#008543] text-white shadow-md shadow-[#009B4F]/20 cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
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
