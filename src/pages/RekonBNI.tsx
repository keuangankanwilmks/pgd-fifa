import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight, Save, Play, RefreshCw, X, Download, FileText, Database, Plus, Edit2, Trash2, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import Select from 'react-select';
import toast from 'react-hot-toast';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { googleSheetsService } from '../services/googleSheetsService';
import { useNotifications } from '../contexts/NotificationContext';
import { AnimatedModal } from '../components/AnimatedModal';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

import { norekService, NoRekMapping } from '../services/norekService';
import { cabangService, type Cabang } from '../services/cabangService';
import { glBankService } from '../services/glBankService';
import { saldoHarianService } from '../services/saldoHarianService';
import { DEFAULT_UPLOAD_EXCEL_CONFIGS, uploadExcelConfigService, type UploadExcelConfigMap } from '../services/uploadExcelConfigService';

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

type ActionModalType = 'return' | 'get';

interface ActionModalRow {
  date: string;
  noBukti: string;
  reference: string;
  amount: string;
  keterangan: string;
}

interface CheckModalState {
  cabang: string;
  sistemRows: SistemData[];
  bankRows: BankData[];
}

interface CabangAggregate<T> {
  cabang: string;
  rows: T[];
  total: number;
}

interface DropPollPreviewRow {
  id: string;
  sheetRowIndex?: number;
  cabang: string;
  source: ActionModalType;
  tanggalRekon: string;
  companyCode: string;
  documentDate: string;
  postingDate: string;
  noBukti: string;
  reference: string;
  dropPool: string;
  profitCenterD: string;
  glAkunD: string;
  profitCenterK: string;
  glAkunK: string;
  amount: string;
  keterangan: string;
}

interface HutangTampunganRow {
  rowIndex: number;
  tanggal: string;
  akunDb: string;
  akunCr: string;
  nominal: number;
  keterangan: string;
  status: string;
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

const formatNumberGroup = (value: any) => {
  const amount = typeof value === 'number' ? value : cleanAmount(value);
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(amount);
};

const formatDateSlash = (date: string) => {
  if (!date) return '';
  const parts = date.split('-');
  if (parts.length !== 3) return date;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const formatDateDot = (date: string) => formatDateSlash(date).replace(/\//g, '.');

const normalizeCabangKey = (cabang: string) => String(cabang || '').trim() || 'TANPA CABANG';

const normalizeCompareText = (value: string) => String(value || '')
  .replace(/^(CP|CPS|UPS|UPC|CAB\.)\s+/i, '')
  .trim()
  .toUpperCase();

const BANK_GL_BY_BANK: Record<string, string> = {
  BRI: '1101206037',
  BNI: '1101204021',
  BSI: '1101208024',
};

const DROP_POLL_HEADERS = [
  'Tanggal Rekon',
  'Company Code',
  'Document Date',
  'Posting Date',
  'No. Bukti',
  'Reference',
  'Drop / Pool',
  'Profit Center (D)',
  'GL Akun (D)',
  'Profit Center (K)',
  'GL Akun (K)',
  'Amount',
  'Keterangan',
];

const parseUpdatedRangeStartRow = (updatedRange?: string) => {
  const match = String(updatedRange || '').match(/![A-Z]+(\d+)/i);
  return match ? Number(match[1]) : null;
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
  const [cabangMaster, setCabangMaster] = useState<Cabang[]>([]);
  const [norekMappings, setNorekMappings] = useState<NoRekMapping[]>([]);
  const [sistemFile, setSistemFile] = useState<File | null>(null);
  const [uploadExcelConfigs, setUploadExcelConfigs] = useState<UploadExcelConfigMap>(DEFAULT_UPLOAD_EXCEL_CONFIGS);

  const [bankFile, setBankFile] = useState<File | null>(null);
  const [hasDateInconsistency, setHasDateInconsistency] = useState(false);
  const { addNotification } = useNotifications();

  const fetchCabang = async () => {
    try {
      // 1. Fetch from Firestore (Primary)
      const firestoreCabang = await cabangService.getAll();
      setCabangMaster(firestoreCabang);
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

  useEffect(() => {
    uploadExcelConfigService.getConfigs()
      .then(setUploadExcelConfigs)
      .catch(error => {
        console.error('Error loading upload excel config:', error);
      });
  }, []);

  const getUploadConfig = (id: string) => uploadExcelConfigs[id] || DEFAULT_UPLOAD_EXCEL_CONFIGS[id];
  
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
  const [activeTabResult, setActiveTabResult] = useState<'cocok' | 'unmatched' | 'analisa'>('cocok');
  const [checkModal, setCheckModal] = useState<CheckModalState | null>(null);
  const [actionModalType, setActionModalType] = useState<ActionModalType | null>(null);
  const [actionModalRows, setActionModalRows] = useState<ActionModalRow[]>([]);
  const [actionModalSource, setActionModalSource] = useState<SistemData | null>(null);
  const [dropPollPreviewRows, setDropPollPreviewRows] = useState<DropPollPreviewRow[]>([]);
  const [editingPreviewRowId, setEditingPreviewRowId] = useState<string | null>(null);
  const [dirtyPreviewRowIds, setDirtyPreviewRowIds] = useState<string[]>([]);
  const [deletedPreviewRows, setDeletedPreviewRows] = useState<DropPollPreviewRow[]>([]);
  const [isSavingActionRows, setIsSavingActionRows] = useState(false);
  const [isSavingPreviewRows, setIsSavingPreviewRows] = useState(false);
  const [isDropPollPreviewOpen, setIsDropPollPreviewOpen] = useState(false);
  const [downloadDropPollRows, setDownloadDropPollRows] = useState<any[][]>([]);
  const [isLoadingDropPollPreview, setIsLoadingDropPollPreview] = useState(false);
  const [isTampunganOpen, setIsTampunganOpen] = useState(false);
  const [isLoadingTampungan, setIsLoadingTampungan] = useState(false);
  const [hutangTampunganRows, setHutangTampunganRows] = useState<HutangTampunganRow[]>([]);
  const [tampunganPosition, setTampunganPosition] = useState({ x: 180, y: 90 });
  const tampunganDragRef = useRef<{ isDragging: boolean; offsetX: number; offsetY: number }>({
    isDragging: false,
    offsetX: 0,
    offsetY: 0,
  });

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
    const config = getUploadConfig('rekon-sistem');
    const col = config.columns;
    const result: SistemData[] = [];
    for (let i = config.firstDataRow; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 10) continue;
      
      const tanggalRaw = row[col.tanggal];
      let textUtama = String(row[col.textUtama] || "").trim();
      const longText = String(row[col.longText] || "").trim();
      const debit = cleanAmount(row[col.debit]);
      const kredit = cleanAmount(row[col.kredit]);
      const balance = cleanAmount(row[col.balance]);
      
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
          const nextTgl = String(nextRow[col.tanggal] || "").trim();
          const nextKetUtama = String(nextRow[col.textUtama] || "").trim();
          const nextLongText = String(nextRow[col.longText] || "").trim();
          
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
    const config = getUploadConfig('rekon-bri-cms');
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
      console.warn(`Could not find BRI header row. Falling back to configured row index ${config.firstDataRow}.`);
      startRow = config.firstDataRow;
    }

    // Try to find column indices from the header row
    let colIdx = {
      tanggal: config.columns.tanggal,
      keterangan: config.columns.keterangan,
      debit: config.columns.debit,
      kredit: config.columns.kredit,
      balance: config.columns.balance
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
    const config = getUploadConfig('rekon-bsi-cms');
    const col = config.columns;
    const result: BankData[] = [];
    
    let startRow = config.firstDataRow;
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
      
      const tanggalRaw = row[col.tanggal];
      let ket = String(row[col.keterangan] || "").trim();
      const amountRaw = row[col.amount];
      const dbRaw = String(row[col.db] || "").trim().toUpperCase();
      const crRaw = String(row[col.cr] || "").trim().toUpperCase();
      const balanceRaw = row[col.balance];

      const amount = cleanAmount(amountRaw);
      const balance = cleanAmount(balanceRaw);
      
      if (tanggalRaw && amount > 0) {
        // Look-ahead for BSI
        let j = i + 1;
        while (j < data.length) {
          const nextRow = data[j];
          if (!nextRow) break;
          const nextTgl = String(nextRow[col.tanggal] || "").trim();
          const nextKet = String(nextRow[col.keterangan] || "").trim();
          
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
    const config = getUploadConfig('rekon-bni-cms');
    const result: BankData[] = [];
    let startRow = 0;
    // Default indices for BNI CMS
    const colIdx = {
      tanggal: config.columns.tanggal,
      keterangan: config.columns.keterangan,
      amount: config.columns.amount,
      dc: config.columns.dc,
      balance: config.columns.balance
    };

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
    if (startRow === 0) startRow = config.firstDataRow;

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

  const buildActionModalRow = (type: ActionModalType, row?: SistemData | null, includeAmount = true): ActionModalRow => {
    const source = row || actionModalSource;
    const tanggal = source?.tanggal || '';
    const tanggalLabel = formatDateSlash(tanggal);
    const cabang = source?.cabang || '';

    return {
      date: type === 'return' ? tanggal : '',
      noBukti: tanggalLabel ? `KOR POLL ${tanggalLabel}` : 'KOR POLL',
      reference: '',
      amount: source && includeAmount ? String(Math.abs(source.nominalNormal)) : '',
      keterangan: `${cabang}${cabang ? ' ' : ''}KOR TRX ${tanggalLabel}`.trim(),
    };
  };

  const openActionModal = (type: ActionModalType, row: SistemData) => {
    setActionModalSource(row);
    setActionModalType(type);
    setActionModalRows([buildActionModalRow(type, row)]);
  };

  const closeActionModal = () => {
    setActionModalType(null);
    setActionModalRows([]);
    setActionModalSource(null);
  };

  const addActionModalRow = () => {
    setActionModalRows(prev => [...prev, buildActionModalRow(actionModalType || 'return', actionModalSource, false)]);
  };

  const updateActionModalRow = (index: number, field: keyof ActionModalRow, value: string) => {
    setActionModalRows(prev => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const updateDropPollPreviewRow = (id: string, field: keyof DropPollPreviewRow, value: string) => {
    setDropPollPreviewRows(prev => prev.map(item => (
      item.id === id ? { ...item, [field]: value } : item
    )));
    setDirtyPreviewRowIds(prev => prev.includes(id) ? prev : [...prev, id]);
  };

  const deleteDropPollPreviewRow = (id: string) => {
    const row = dropPollPreviewRows.find(item => item.id === id);
    if (row?.sheetRowIndex) {
      setDeletedPreviewRows(prev => prev.some(item => item.id === id) ? prev : [...prev, row]);
    }
    setDropPollPreviewRows(prev => prev.filter(item => item.id !== id));
    setDirtyPreviewRowIds(prev => prev.filter(itemId => itemId !== id));
    if (editingPreviewRowId === id) {
      setEditingPreviewRowId(null);
    }
  };

  const getRekonDate = () => sistemData[0]?.tanggal || bankData[0]?.tanggal || '';

  const previewRowToSheetRow = (row: DropPollPreviewRow) => [
    row.tanggalRekon,
    row.companyCode,
    row.documentDate,
    row.postingDate,
    row.noBukti,
    row.reference,
    row.dropPool,
    row.profitCenterD,
    row.glAkunD,
    row.profitCenterK,
    row.glAkunK,
    row.amount,
    row.keterangan,
  ];

  const getCabangSapCode = (cabang?: Cabang | null) => (
    String(cabang?.sapCode || cabang?.sapcode || cabang?.SAPCODE || cabang?.SapCode || cabang?.id || '').trim()
  );

  const findCabangMaster = (rows: Cabang[], cabang: string) => {
    const target = normalizeCompareText(cabang);
    return rows.find(item => (
      normalizeCompareText(item.nama) === target ||
      normalizeCompareText(item.id || '') === target ||
      String(item.nama || '').trim().toUpperCase() === String(cabang || '').trim().toUpperCase()
    ));
  };

  const ensureDropPollSheet = async (spreadsheetId: string) => {
    await googleSheetsService.ensureSheet(spreadsheetId, 'Drop/Poll');
    const rows = await googleSheetsService.readData(spreadsheetId, "'Drop/Poll'!A1:M1", 'FORMATTED_VALUE', true);
    if (!rows || rows.length === 0 || rows[0]?.[0] !== DROP_POLL_HEADERS[0]) {
      await googleSheetsService.updateData(spreadsheetId, "'Drop/Poll'!A1:M1", [DROP_POLL_HEADERS]);
    }
  };

  const buildDropPollRows = async () => {
    if (!actionModalType || !actionModalSource) {
      throw new Error('Data sumber Return/Get tidak tersedia');
    }

    let masterCabangRows = cabangMaster;
    let cabangInfo = findCabangMaster(masterCabangRows, actionModalSource.cabang);
    let sapCode = getCabangSapCode(cabangInfo);

    if (!sapCode) {
      masterCabangRows = await cabangService.getAll();
      setCabangMaster(masterCabangRows);
      cabangInfo = findCabangMaster(masterCabangRows, actionModalSource.cabang);
      sapCode = getCabangSapCode(cabangInfo);
    }

    if (!sapCode) {
      throw new Error(`SAP Code cabang ${actionModalSource.cabang || '-'} tidak ditemukan pada master cabang`);
    }

    const glBank = await glBankService.getByBank(bank);
    const glBankNumber = String(glBank?.nomorGL || glBank?.gl || '').trim();
    if (!glBankNumber) {
      throw new Error(`Nomor GL untuk bank ${bank} tidak ditemukan pada master gl_bank`);
    }

    const bankGl = BANK_GL_BY_BANK[String(bank || '').trim().toUpperCase()];
    if (!bankGl) {
      throw new Error(`GL akun default bank ${bank} belum dikonfigurasi`);
    }

    const sourceDate = actionModalSource.tanggal;
    const dropPool = actionModalType === 'return' ? 'D' : 'P';
    const validRows = actionModalRows.filter(row => (
      row.date || row.noBukti || row.reference || row.amount || row.keterangan
    ));

    if (validRows.length === 0) {
      throw new Error('Tidak ada data untuk disimpan');
    }

    return validRows.map((row, index) => {
      const documentDate = formatDateDot(row.date);
      const amount = cleanAmount(row.amount);
      const preview: DropPollPreviewRow = {
        id: `${Date.now()}-${index}`,
        cabang: normalizeCabangKey(actionModalSource.cabang),
        source: actionModalType,
        tanggalRekon: sourceDate,
        companyCode: 'PGD',
        documentDate,
        postingDate: documentDate,
        noBukti: row.noBukti,
        reference: row.reference,
        dropPool,
        profitCenterD: actionModalType === 'return' ? sapCode : 'PKF000001',
        glAkunD: actionModalType === 'return' ? bankGl : glBankNumber,
        profitCenterK: actionModalType === 'return' ? 'PKF000001' : sapCode,
        glAkunK: actionModalType === 'return' ? glBankNumber : bankGl,
        amount: amount ? String(amount) : row.amount,
        keterangan: row.keterangan,
      };

      return {
        preview,
        sheetRow: previewRowToSheetRow(preview),
      };
    });
  };

  const saveActionRows = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsSavingActionRows(true);
    try {
      const rows = await buildDropPollRows();
      await ensureDropPollSheet(spreadsheetId);
      const appendResult = await googleSheetsService.appendData(spreadsheetId, "'Drop/Poll'!A1", rows.map(item => item.sheetRow));
      const startRow = parseUpdatedRangeStartRow(appendResult?.updates?.updatedRange);
      setDropPollPreviewRows(prev => [
        ...prev,
        ...rows.map((item, index) => ({
          ...item.preview,
          sheetRowIndex: startRow ? startRow + index : undefined,
        })),
      ]);
      toast.success(`${rows.length} data berhasil disimpan ke sheet Drop/Poll`);
      closeActionModal();
    } catch (error: any) {
      console.error('Save Drop/Poll error:', error);
      toast.error(error.message || 'Gagal menyimpan data Drop/Poll');
    } finally {
      setIsSavingActionRows(false);
    }
  };

  const savePreviewChanges = async () => {
    if (dirtyPreviewRowIds.length === 0 && deletedPreviewRows.length === 0) return;

    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsSavingPreviewRows(true);
    try {
      const dirtyRows = dropPollPreviewRows.filter(row => dirtyPreviewRowIds.includes(row.id) && row.sheetRowIndex);

      await Promise.all(dirtyRows.map(row => (
        googleSheetsService.updateData(spreadsheetId, `'Drop/Poll'!A${row.sheetRowIndex}:M${row.sheetRowIndex}`, [previewRowToSheetRow(row)])
      )));

      const deletedSheetRows = deletedPreviewRows
        .map(row => row.sheetRowIndex)
        .filter((rowIndex): rowIndex is number => typeof rowIndex === 'number');

      if (deletedSheetRows.length > 0) {
        const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, 'Drop/Poll');
        if (sheetId === null) {
          throw new Error('Sheet Drop/Poll tidak ditemukan');
        }
        await googleSheetsService.deleteRows(spreadsheetId, sheetId, deletedSheetRows.map(rowIndex => rowIndex - 1));
      }

      setDropPollPreviewRows(prev => prev.map(row => {
        if (!row.sheetRowIndex) return row;
        const deletedBeforeCount = deletedSheetRows.filter(deletedRowIndex => deletedRowIndex < row.sheetRowIndex!).length;
        return deletedBeforeCount > 0 ? { ...row, sheetRowIndex: row.sheetRowIndex - deletedBeforeCount } : row;
      }));
      setDirtyPreviewRowIds([]);
      setDeletedPreviewRows([]);
      setEditingPreviewRowId(null);
      toast.success('Perubahan preview berhasil disimpan ke Google Sheet');
    } catch (error: any) {
      console.error('Save Drop/Poll preview changes error:', error);
      toast.error(error.message || 'Gagal menyimpan perubahan preview');
    } finally {
      setIsSavingPreviewRows(false);
    }
  };

  const aggregateByCabang = <T extends { cabang: string; nominalNormal: number }>(rows: T[]): CabangAggregate<T>[] => {
    const grouped = rows.reduce<Record<string, CabangAggregate<T>>>((acc, row) => {
      const cabang = normalizeCabangKey(row.cabang);
      if (!acc[cabang]) {
        acc[cabang] = { cabang, rows: [], total: 0 };
      }
      acc[cabang].rows.push(row);
      acc[cabang].total += row.nominalNormal;
      return acc;
    }, {});

    return Object.values(grouped).sort((a, b) => a.cabang.localeCompare(b.cabang));
  };

  const openCheckModal = (cabang: string) => {
    if (!rekonResult) return;
    const cabangKey = normalizeCabangKey(cabang);
    setCheckModal({
      cabang: cabangKey,
      sistemRows: rekonResult.hanyaDiSistem.filter(item => normalizeCabangKey(item.cabang) === cabangKey),
      bankRows: rekonResult.hanyaDiBank.filter(item => normalizeCabangKey(item.cabang) === cabangKey),
    });
    setIsTampunganOpen(false);
    setHutangTampunganRows([]);
  };

  const loadHutangTampungan = async () => {
    if (!checkModal) return;
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    setIsLoadingTampungan(true);
    setIsTampunganOpen(true);
    setTampunganPosition({ x: 180, y: 90 });
    try {
      const values = await googleSheetsService.readData(spreadsheetId, 'HutOpr!A2:G');
      const cabangKey = normalizeCompareText(checkModal.cabang);
      const mapped: HutangTampunganRow[] = (values || []).map((row: any, index: number) => ({
        rowIndex: index + 2,
        tanggal: row[0] || '',
        akunDb: row[1] || '',
        akunCr: row[2] || '',
        nominal: cleanAmount(row[3]),
        keterangan: row[4] || '',
        status: row[5] || 'Belum',
      }));

      setHutangTampunganRows(mapped.filter(item => (
        normalizeCompareText(item.akunCr) === cabangKey &&
        normalizeCompareText(item.status || 'Belum') === 'BELUM'
      )));
    } catch (error: any) {
      console.error('Load tampungan HutOpr error:', error);
      toast.error(error.message || 'Gagal memuat data tampungan');
    } finally {
      setIsLoadingTampungan(false);
    }
  };

  const startTampunganDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    tampunganDragRef.current = {
      isDragging: true,
      offsetX: event.clientX - tampunganPosition.x,
      offsetY: event.clientY - tampunganPosition.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!tampunganDragRef.current.isDragging) return;
      setTampunganPosition({
        x: Math.max(8, event.clientX - tampunganDragRef.current.offsetX),
        y: Math.max(8, event.clientY - tampunganDragRef.current.offsetY),
      });
    };

    const handleMouseUp = () => {
      tampunganDragRef.current.isDragging = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const sistemAggregates = rekonResult ? aggregateByCabang(rekonResult.hanyaDiSistem) : [];
  const bankAggregates = rekonResult ? aggregateByCabang(rekonResult.hanyaDiBank) : [];
  const checkSistemTotal = checkModal ? checkModal.sistemRows.reduce((sum, item) => sum + item.nominalNormal, 0) : 0;
  const checkBankTotal = checkModal ? checkModal.bankRows.reduce((sum, item) => sum + item.nominalNormal, 0) : 0;
  const checkDifference = checkSistemTotal - checkBankTotal;
  const checkPreviewRows = checkModal
    ? dropPollPreviewRows.filter(item => item.cabang === normalizeCabangKey(checkModal.cabang))
    : [];
  const hasPreviewChanges = dirtyPreviewRowIds.length > 0 || deletedPreviewRows.length > 0;

  useEscapeToClose(!!actionModalType && !isSavingActionRows, closeActionModal);
  useEscapeToClose(!actionModalType && isTampunganOpen, () => setIsTampunganOpen(false));
  useEscapeToClose(!actionModalType && !isTampunganOpen && !!checkModal, () => setCheckModal(null));
  useEscapeToClose(!actionModalType && !isTampunganOpen && !checkModal && isDropPollPreviewOpen, () => setIsDropPollPreviewOpen(false));

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

  const loadDropPollPreview = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    const rekonDate = getRekonDate();

    if (!spreadsheetId) {
      toast.error('Spreadsheet ID belum dikonfigurasi');
      return;
    }

    if (!rekonDate) {
      toast.error('Tanggal rekon tidak ditemukan');
      return;
    }

    setIsLoadingDropPollPreview(true);
    try {
      const rows = await googleSheetsService.readData(spreadsheetId, "'Drop/Poll'!A:M", 'FORMATTED_VALUE', true);
      if (!rows || rows.length <= 1) {
        toast.error('Belum ada data pada sheet Drop/Poll');
        return;
      }

      const filteredRows = rows.slice(1).filter((row: any[]) => String(row?.[0] || '').trim() === rekonDate);

      if (filteredRows.length === 0) {
        toast.error(`Tidak ada data Drop/Poll untuk tanggal rekon ${rekonDate}`);
        return;
      }

      setDownloadDropPollRows(filteredRows);
      setIsDropPollPreviewOpen(true);
    } catch (error: any) {
      console.error('Load Drop/Poll preview error:', error);
      toast.error(error.message || 'Gagal memuat preview Drop/Poll');
    } finally {
      setIsLoadingDropPollPreview(false);
    }
  };

  const exportDropPollExcel = () => {
    const rekonDate = getRekonDate();
    if (downloadDropPollRows.length === 0) {
      toast.error('Tidak ada data Drop/Poll untuk diunduh');
      return;
    }

    const headers = DROP_POLL_HEADERS.slice(1);
    const amountColumnIndex = headers.indexOf('Amount');
    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      ...downloadDropPollRows.map((row: any[]) => DROP_POLL_HEADERS.slice(1).map((_, index) => (
        index === amountColumnIndex ? cleanAmount(row[index + 1]) : (row[index + 1] ?? '')
      ))),
    ]);
    worksheet['!cols'] = headers.map((header: string) => ({ wch: Math.max(14, header.length + 2) }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Drop Poll');
    XLSX.writeFile(workbook, `Dropping_Polling_SAP_${bank}_${rekonDate}.xlsx`);
    toast.success('File Drop/Poll berhasil diunduh');
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

      // 5. Upsert daily ending balances into SaldoHarian.
      setLoadingMessage('Menyimpan Saldo Harian...');
      const saldoTanggal = Array.from(datesInSession).sort()[0] || new Date().toISOString().split('T')[0];
      await saldoHarianService.upsert(spreadsheetId, {
        tanggal: saldoTanggal,
        bank,
        saldoBank: rekonResult.analisa.balanceAkhirBank,
        saldoSistem: rekonResult.analisa.balanceAkhirSistem,
      });

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
                <button onClick={loadDropPollPreview} disabled={isLoadingDropPollPreview} className="px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2 text-xs font-bold border-l border-gray-100 cursor-pointer disabled:opacity-60 disabled:cursor-wait">
                  <FileSpreadsheet className={`w-4 h-4 text-[#009B4F] ${isLoadingDropPollPreview ? 'animate-pulse' : ''}`} />
                  Drop/Poll
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
              onClick={() => setActiveTabResult('unmatched')}
              className={`flex-1 py-4 font-bold text-sm transition-colors cursor-pointer ${activeTabResult === 'unmatched' ? 'bg-red-50 text-red-600 border-b-2 border-red-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              ❌ DATA UNMATCHED ({rekonResult.hanyaDiSistem.length + rekonResult.hanyaDiBank.length})
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

            {activeTabResult === 'unmatched' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="min-w-0 overflow-hidden rounded-xl border border-red-100 bg-white">
                  <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-4 py-3">
                    <h4 className="text-sm font-black text-red-700">DATA SISTEM/OUTSTANDING ({sistemAggregates.length} Cabang)</h4>
                    <span className="text-xs font-bold text-red-600">{formatCurrency(rekonResult.analisa.totalOutstanding)}</span>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full min-w-[620px] text-left text-xs border-collapse">
                      <thead className="bg-red-50 text-red-600">
                        <tr>
                          <th className="py-3 px-3 border-b border-red-100">Cabang</th>
                          <th className="py-3 px-3 border-b border-red-100 text-center">Jumlah Trx</th>
                          <th className="py-3 px-3 border-b border-red-100 text-right">Total Nominal</th>
                          <th className="py-3 px-3 border-b border-red-100 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sistemAggregates.map(group => (
                          <tr key={group.cabang} className="hover:bg-red-50/30">
                            <td className="py-2 px-3 font-medium whitespace-nowrap">{group.cabang}</td>
                            <td className="py-2 px-3 text-center font-mono">{group.rows.length}</td>
                            <td className="py-2 px-3 text-right font-medium text-red-600 whitespace-nowrap">{formatCurrency(group.total)}</td>
                            <td className="py-2 px-3">
                              <div className="flex justify-center gap-2">
                                <button
                                  onClick={() => openCheckModal(group.cabang)}
                                  className="rounded-lg bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-600 transition-colors hover:bg-red-100"
                                >
                                  Check
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-red-50/50 font-bold">
                          <td colSpan={2} className="py-3 px-3 text-right">TOTAL OUTSTANDING</td>
                          <td className="py-3 px-3 text-right text-red-600">{formatCurrency(rekonResult.analisa.totalOutstanding)}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="min-w-0 overflow-hidden rounded-xl border border-orange-100 bg-white">
                  <div className="flex items-center justify-between border-b border-orange-100 bg-orange-50 px-4 py-3">
                    <h4 className="text-sm font-black text-orange-700">DATA CMS/BELUM DIBUKUKAN ({bankAggregates.length} Cabang)</h4>
                    <span className="text-xs font-bold text-orange-600">{formatCurrency(rekonResult.analisa.totalBelumDibukukan)}</span>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full min-w-[620px] text-left text-xs border-collapse">
                      <thead className="bg-orange-50 text-orange-600">
                        <tr>
                          <th className="py-3 px-3 border-b border-orange-100">Cabang</th>
                          <th className="py-3 px-3 border-b border-orange-100 text-center">Jumlah Trx</th>
                          <th className="py-3 px-3 border-b border-orange-100 text-right">Total Nominal</th>
                          <th className="py-3 px-3 border-b border-orange-100 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bankAggregates.map(group => (
                          <tr key={group.cabang} className="hover:bg-orange-50/30">
                            <td className="py-2 px-3 font-medium whitespace-nowrap">{group.cabang}</td>
                            <td className="py-2 px-3 text-center font-mono">{group.rows.length}</td>
                            <td className="py-2 px-3 text-right font-medium text-orange-600 whitespace-nowrap">{formatCurrency(group.total)}</td>
                            <td className="py-2 px-3">
                              <div className="flex justify-center">
                                <button
                                  onClick={() => openCheckModal(group.cabang)}
                                  className="rounded-lg bg-orange-50 px-3 py-1.5 text-[11px] font-bold text-orange-600 transition-colors hover:bg-orange-100"
                                >
                                  Check
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-orange-50/50 font-bold">
                          <td colSpan={2} className="py-3 px-3 text-right">TOTAL BELUM DIBUKUKAN</td>
                          <td className="py-3 px-3 text-right text-orange-600">{formatCurrency(rekonResult.analisa.totalBelumDibukukan)}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
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

      <AnimatedModal isOpen={isDropPollPreviewOpen} className="fixed inset-0 z-[115] flex items-center justify-center bg-black/50 p-4">
        <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-lg font-black text-gray-800">Preview Data Drop/Poll {bank}</h2>
              <p className="mt-1 text-xs font-medium text-gray-500">Tanggal rekon: {getRekonDate() || '-'}</p>
            </div>
            <button
              onClick={() => setIsDropPollPreviewOpen(false)}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-gray-50/50 p-4">
            <table className="w-full min-w-[1180px] border-collapse bg-white text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#005245]">
                  {DROP_POLL_HEADERS.slice(1).map(header => (
                    <th key={header} className="border border-[#004237] px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest text-white">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {downloadDropPollRows.map((row, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                    {DROP_POLL_HEADERS.slice(1).map((header, headerIndex) => (
                      <td key={`${index}-${header}`} className={`border border-gray-200 px-3 py-2 ${header === 'Amount' ? 'text-right font-mono' : ''}`}>
                        {header === 'Amount' ? formatNumberGroup(row[headerIndex + 1]) : (row[headerIndex + 1] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 bg-white px-5 py-4">
            <button
              onClick={() => setIsDropPollPreviewOpen(false)}
              className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Tutup
            </button>
            <button
              onClick={exportDropPollExcel}
              className="flex items-center gap-2 rounded-lg bg-[#009B4F] px-5 py-2 text-xs font-bold text-white shadow-md shadow-[#009B4F]/10 transition-colors hover:bg-[#008543]"
            >
              <Download className="h-4 w-4" />
              Unduh Excel
            </button>
          </div>
        </div>
      </AnimatedModal>

      <AnimatedModal isOpen={!!checkModal} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
        <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div>
                <h2 className="text-lg font-black text-gray-800">Rekon {bank} {checkModal?.cabang}</h2>
                <p className="mt-1 text-xs font-medium text-gray-500">Rincian transaksi unmatched per cabang.</p>
              </div>
              <button
                onClick={loadHutangTampungan}
                disabled={isLoadingTampungan}
                className="flex w-fit cursor-pointer items-center gap-2 rounded-lg bg-[#009B4F] px-3 py-2 text-xs font-bold text-white shadow-md shadow-[#009B4F]/10 transition-colors hover:bg-[#008543] disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingTampungan ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Database className="h-4 w-4" />
                )}
                Cek Tampungan
              </button>
            </div>
            <button
              onClick={() => setCheckModal(null)}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {checkModal && (
            <>
              <div className="grid grid-cols-1 gap-3 border-b border-gray-100 bg-gray-50/70 px-5 py-4 md:grid-cols-3">
                <div className="rounded-xl border border-red-100 bg-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-500">DATA SISTEM/OUTSTANDING</p>
                  <p className="mt-2 text-lg font-black text-red-600">{formatCurrency(checkSistemTotal)}</p>
                </div>
                <div className="rounded-xl border border-orange-100 bg-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-orange-500">DATA CMS/BELUM DIBUKUKAN</p>
                  <p className="mt-2 text-lg font-black text-orange-600">{formatCurrency(checkBankTotal)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Selisih Sistem - CMS</p>
                  <p className={`mt-2 text-lg font-black ${checkDifference === 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(checkDifference)}</p>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-gray-50/50 p-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className="overflow-hidden rounded-xl border border-red-100 bg-white">
                    <div className="border-b border-red-100 bg-red-50 px-4 py-3">
                      <h3 className="text-sm font-black text-red-700">Rincian DATA SISTEM/OUTSTANDING ({checkModal.sistemRows.length})</h3>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full min-w-[620px] border-collapse text-[12px]">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[#005245]">
                            <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Keterangan</th>
                            <th className="w-[150px] border border-[#004237] px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Nominal</th>
                            <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Cabang</th>
                            <th className="w-[126px] border border-[#004237] px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white">Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {checkModal.sistemRows.map((row, index) => (
                            <tr key={row.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                              <td className="border border-gray-200 px-3 py-2">{row.keterangan}</td>
                              <td className="border border-gray-200 px-3 py-2 text-right font-mono font-bold text-red-600 whitespace-nowrap">{formatCurrency(row.nominalNormal)}</td>
                              <td className="border border-gray-200 px-3 py-2 font-medium">{row.cabang}</td>
                              <td className="border border-gray-200 px-2 py-2">
                                <div className="flex justify-center gap-1.5">
                                  <button
                                    onClick={() => openActionModal('return', row)}
                                    className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-600 transition-colors hover:bg-red-100"
                                  >
                                    Return
                                  </button>
                                  <button
                                    onClick={() => openActionModal('get', row)}
                                    className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-[#009B4F] transition-colors hover:bg-emerald-100"
                                  >
                                    Get
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-orange-100 bg-white">
                    <div className="border-b border-orange-100 bg-orange-50 px-4 py-3">
                      <h3 className="text-sm font-black text-orange-700">Rincian DATA CMS/BELUM DIBUKUKAN ({checkModal.bankRows.length})</h3>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full min-w-[680px] border-collapse text-[12px]">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[#005245]">
                            <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Keterangan</th>
                            <th className="border border-[#004237] px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Nominal</th>
                            <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Cabang</th>
                            <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Keterangan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {checkModal.bankRows.map((row, index) => (
                            <tr key={row.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                              <td className="border border-gray-200 px-3 py-2">{row.keterangan}</td>
                              <td className="border border-gray-200 px-3 py-2 text-right font-mono font-bold text-orange-600">{formatCurrency(row.nominalNormal)}</td>
                              <td className="border border-gray-200 px-3 py-2 font-medium">{row.cabang}</td>
                              <td className="border border-gray-200 p-0">
                                <input
                                  type="text"
                                  placeholder="Tambah keterangan..."
                                  value={row.catatan || ''}
                                  onChange={(event) => handleCatatanChange(row.id, event.target.value, 'bank')}
                                  className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 bg-white px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-black text-gray-800">Preview Data Drop/Poll {checkModal.cabang}</h3>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{checkPreviewRows.length} baris</span>
                    <button
                      onClick={savePreviewChanges}
                      disabled={!hasPreviewChanges || isSavingPreviewRows}
                      className="rounded-lg bg-[#009B4F] px-4 py-2 text-xs font-bold text-white shadow-md shadow-[#009B4F]/10 transition-colors hover:bg-[#008543] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isSavingPreviewRows ? 'Menyimpan...' : 'Simpan'}
                    </button>
                  </div>
                </div>
                <div className="max-h-56 overflow-auto rounded-xl border border-gray-100">
                  <table className="w-full min-w-[1320px] border-collapse bg-white text-[11px]">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#005245]">
                        {[...DROP_POLL_HEADERS, 'Aksi'].map(header => (
                          <th key={header} className={`border border-[#004237] px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white ${header === 'Aksi' ? 'text-center' : 'text-left'}`}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {checkPreviewRows.length > 0 ? checkPreviewRows.map((row, index) => (
                        <tr key={row.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                          {editingPreviewRowId === row.id ? (
                            <>
                              <td className="border border-gray-200 p-0"><input value={row.tanggalRekon} onChange={(event) => updateDropPollPreviewRow(row.id, 'tanggalRekon', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.companyCode} onChange={(event) => updateDropPollPreviewRow(row.id, 'companyCode', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.documentDate} onChange={(event) => updateDropPollPreviewRow(row.id, 'documentDate', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.postingDate} onChange={(event) => updateDropPollPreviewRow(row.id, 'postingDate', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.noBukti} onChange={(event) => updateDropPollPreviewRow(row.id, 'noBukti', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.reference} onChange={(event) => updateDropPollPreviewRow(row.id, 'reference', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.dropPool} onChange={(event) => updateDropPollPreviewRow(row.id, 'dropPool', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] font-bold outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.profitCenterD} onChange={(event) => updateDropPollPreviewRow(row.id, 'profitCenterD', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.glAkunD} onChange={(event) => updateDropPollPreviewRow(row.id, 'glAkunD', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.profitCenterK} onChange={(event) => updateDropPollPreviewRow(row.id, 'profitCenterK', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.glAkunK} onChange={(event) => updateDropPollPreviewRow(row.id, 'glAkunK', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.amount} onChange={(event) => updateDropPollPreviewRow(row.id, 'amount', event.target.value)} className="h-8 w-full border-0 px-2 text-right font-mono text-[11px] outline-none focus:bg-emerald-50" /></td>
                              <td className="border border-gray-200 p-0"><input value={row.keterangan} onChange={(event) => updateDropPollPreviewRow(row.id, 'keterangan', event.target.value)} className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50" /></td>
                            </>
                          ) : (
                            <>
                              <td className="border border-gray-200 px-3 py-2">{row.tanggalRekon}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.companyCode}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.documentDate}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.postingDate}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.noBukti}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.reference}</td>
                              <td className="border border-gray-200 px-3 py-2 font-bold">{row.dropPool}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.profitCenterD}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.glAkunD}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.profitCenterK}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.glAkunK}</td>
                              <td className="border border-gray-200 px-3 py-2 text-right font-mono">{formatNumberGroup(row.amount)}</td>
                              <td className="border border-gray-200 px-3 py-2">{row.keterangan}</td>
                            </>
                          )}
                          <td className="border border-gray-200 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setEditingPreviewRowId(editingPreviewRowId === row.id ? null : row.id)}
                                className={`rounded-lg p-1.5 transition-colors ${editingPreviewRowId === row.id ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                                title={editingPreviewRowId === row.id ? 'Simpan' : 'Edit Baris'}
                              >
                                {editingPreviewRowId === row.id ? <Check className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                onClick={() => deleteDropPollPreviewRow(row.id)}
                                className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                                title="Hapus Data"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={DROP_POLL_HEADERS.length + 1} className="px-4 py-8 text-center text-xs italic text-gray-400">
                            Belum ada data Return/Get yang disimpan untuk cabang ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </AnimatedModal>

      {isTampunganOpen && checkModal && (
        <div
          className="fixed z-[125] flex max-h-[72vh] w-[min(980px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
          style={{ left: tampunganPosition.x, top: tampunganPosition.y }}
        >
          <div
            onMouseDown={startTampunganDrag}
            className="flex cursor-move items-center justify-between border-b border-gray-100 bg-white px-5 py-4"
          >
            <div>
              <h2 className="text-lg font-black text-gray-800">Cek Tampungan {checkModal.cabang}</h2>
              <p className="mt-1 text-xs font-medium text-gray-500">Data Hutang Operasional Lain status Belum untuk cabang terkait.</p>
            </div>
            <button
              onClick={() => setIsTampunganOpen(false)}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-gray-50/30">
            <table className="w-full min-w-[920px] border-collapse text-[12px]">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-[#004237] bg-[#005245]">
                  <th className="border-r border-[#004237]/50 px-4 py-2 text-left text-[9px] font-black uppercase tracking-widest text-white">Tanggal</th>
                  <th className="border-r border-[#004237]/50 px-4 py-2 text-left text-[9px] font-black uppercase tracking-widest text-white">AKUN (Db)</th>
                  <th className="border-r border-[#004237]/50 px-4 py-2 text-left text-[9px] font-black uppercase tracking-widest text-white">AKUN (Cr)</th>
                  <th className="border-r border-[#004237]/50 px-4 py-2 text-right text-[9px] font-black uppercase tracking-widest text-white">Nominal</th>
                  <th className="border-r border-[#004237]/50 px-4 py-2 text-left text-[9px] font-black uppercase tracking-widest text-white">Keterangan</th>
                  <th className="px-4 py-2 text-center text-[9px] font-black uppercase tracking-widest text-white">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {isLoadingTampungan ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-[#009B4F]/20 border-t-[#009B4F]" />
                      <p className="text-xs font-medium text-gray-400">Memuat data tampungan...</p>
                    </td>
                  </tr>
                ) : hutangTampunganRows.length > 0 ? (
                  hutangTampunganRows.map((item, index) => (
                    <tr key={item.rowIndex} className={`transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40`}>
                      <td className="whitespace-nowrap border-r border-gray-50 px-4 py-2 text-[11px] font-semibold text-gray-600">{item.tanggal}</td>
                      <td className="border-r border-gray-50 px-4 py-2 text-[11px] text-gray-800">{item.akunDb}</td>
                      <td className="border-r border-gray-50 px-4 py-2 text-[11px] text-gray-800">{item.akunCr}</td>
                      <td className="border-r border-gray-50 px-4 py-2 text-right font-mono text-[11px] font-black text-blue-600">{formatCurrency(item.nominal)}</td>
                      <td className="max-w-xs truncate border-r border-gray-50 px-4 py-2 text-[11px] font-medium text-gray-700 hover:whitespace-normal">{item.keterangan}</td>
                      <td className="px-4 py-2 text-center">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-red-700 shadow-sm">
                          <AlertCircle className="h-3 w-3" />
                          {item.status || 'Belum'}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-xs italic text-gray-400">
                      Tidak ada data Hutang Operasional Lain berstatus Belum untuk cabang ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatedModal isOpen={!!actionModalType} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
        <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="text-lg font-black text-gray-800">
              {actionModalType === 'return' ? 'Return Data Outstanding' : 'Get Data Outstanding'}
            </h2>
            <button
              onClick={closeActionModal}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              disabled={isSavingActionRows}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-gray-50/50 p-4">
            <table className="w-full min-w-[920px] border-collapse bg-white text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#005245]">
                  <th className="w-12 border border-[#004237] px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white">No</th>
                  <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">
                    {actionModalType === 'return' ? 'Return Date' : 'Get Date'}
                  </th>
                  <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">No. Bukti</th>
                  <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Reference</th>
                  <th className="border border-[#004237] px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Amount</th>
                  <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {actionModalRows.map((row, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                    <td className="border border-gray-200 px-3 py-1 text-center font-mono text-[11px] text-gray-400">{index + 1}</td>
                    <td className="border border-gray-200 p-0">
                      <input
                        type="date"
                        value={row.date}
                        onChange={(event) => updateActionModalRow(index, 'date', event.target.value)}
                        className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                      />
                    </td>
                    <td className="border border-gray-200 p-0">
                      <input
                        value={row.noBukti}
                        onChange={(event) => updateActionModalRow(index, 'noBukti', event.target.value)}
                        className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                      />
                    </td>
                    <td className="border border-gray-200 p-0">
                      <input
                        value={row.reference}
                        onChange={(event) => updateActionModalRow(index, 'reference', event.target.value)}
                        className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                      />
                    </td>
                    <td className="border border-gray-200 p-0">
                      <input
                        value={row.amount}
                        onChange={(event) => updateActionModalRow(index, 'amount', event.target.value)}
                        className="h-8 w-full border-0 px-2 text-right font-mono text-[11px] outline-none focus:bg-emerald-50"
                      />
                    </td>
                    <td className="border border-gray-200 p-0">
                      <input
                        value={row.keterangan}
                        onChange={(event) => updateActionModalRow(index, 'keterangan', event.target.value)}
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
              onClick={addActionModalRow}
              disabled={isSavingActionRows}
              className="flex w-fit items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
              Tambah Baris
            </button>
            <div className="flex justify-end gap-2">
              <button
                onClick={closeActionModal}
                disabled={isSavingActionRows}
                className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={saveActionRows}
                disabled={isSavingActionRows}
                className="rounded-lg bg-[#009B4F] px-5 py-2 text-xs font-bold text-white shadow-md shadow-[#009B4F]/10 transition-colors hover:bg-[#008543] disabled:opacity-60 disabled:cursor-wait"
              >
                {isSavingActionRows ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      </AnimatedModal>
    </div>
  );
}
