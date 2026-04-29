import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight, Save, X, Database, RefreshCw, Play } from 'lucide-react';
import * as XLSX from 'xlsx';
import Select from 'react-select';
import toast from 'react-hot-toast';
import { googleSheetsService } from '../services/googleSheetsService';
import { useNotifications } from '../contexts/NotificationContext';
import { cabangService } from '../services/cabangService';
import { norekService, NoRekMapping } from '../services/norekService';
import { plafonService } from '../services/plafonService';

interface MokerData {
  id: string;
  tanggal: string;
  keterangan: string;
  nominal: number;
  cabang: string;
  bank: string;
  type: 'dropping' | 'pooling';
}

interface BniSystemData {
  id: string;
  tanggal: string;
  keterangan: string;
  nominal: number;
  cabang: string;
  docNumber: string;
}

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
  const [cabangOptions, setCabangOptions] = useState<{ value: string; label: string }[]>([]);
  const [norekMappings, setNorekMappings] = useState<NoRekMapping[]>([]);
  const [plafonData, setPlafonData] = useState<Record<string, number>>({});

  useEffect(() => {
    const loadPlafon = async () => {
      try {
        const data = await plafonService.getAll();
        setPlafonData(data);
      } catch (error) {
        console.error('Error loading plafon:', error);
      }
    };
    loadPlafon();
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const { addNotification } = useNotifications();

  const [bniData, setBniData] = useState<MokerData[]>([]);
  const [briData, setBriData] = useState<MokerData[]>([]);
  const [bsiData, setBsiData] = useState<MokerData[]>([]);
  const [bniSystemData, setBniSystemData] = useState<BniSystemData[]>([]);

  const [bniFile, setBniFile] = useState<File | null>(null);
  const [briFile, setBriFile] = useState<File | null>(null);
  const [bsiFile, setBsiFile] = useState<File | null>(null);
  const [bniSystemFile, setBniSystemFile] = useState<File | null>(null);
  const [hasDateInconsistency, setHasDateInconsistency] = useState(false);

  const bniInputRef = useRef<HTMLInputElement>(null);
  const briInputRef = useRef<HTMLInputElement>(null);
  const bsiInputRef = useRef<HTMLInputElement>(null);
  const bniSystemInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkDateConsistency = () => {
      const dates: { bank: string, date: string }[] = [];
      if (bniData.length > 0) dates.push({ bank: 'BNI', date: bniData[0].tanggal });
      if (briData.length > 0) dates.push({ bank: 'BRI', date: briData[0].tanggal });
      if (bsiData.length > 0) dates.push({ bank: 'BSI', date: bsiData[0].tanggal });
      if (bniSystemData.length > 0) dates.push({ bank: 'Sistem BNI', date: bniSystemData[0].tanggal });

      if (dates.length > 1) {
        const firstDate = dates[0].date;
        const inconsistent = dates.filter(d => d.date !== firstDate);
        
        if (inconsistent.length > 0) {
          setHasDateInconsistency(true);
          const details = dates.map(d => `${d.bank}: ${d.date}`).join(', ');
          toast.error(
            `Peringatan: Inconsistency Tanggal! Ditemukan perbedaan tanggal antar file: ${details}. Pastikan semua file memiliki tanggal yang sama.`,
            { duration: 10000, id: 'date-inconsistency-moker' }
          );
        } else {
          setHasDateInconsistency(false);
        }
      } else {
        setHasDateInconsistency(false);
      }
    };

    checkDateConsistency();
  }, [bniData, briData, bsiData, bniSystemData]);

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

      const mappings = await norekService.getAll();
      setNorekMappings(mappings);

      const plafons = await plafonService.getAll();
      setPlafonData(plafons);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData(false); // Initial fetch without loading indicator
  }, []);

  const getCabang = (keterangan: string, bankName: string) => {
    if (!keterangan) return "-";
    let ketUpper = keterangan.toUpperCase();
    
    // Rule 4: Special Case CPS LUWU
    if (ketUpper.includes("CPS LUWU")) return "CPS L U W U";

    // Rule 2: BNI Logic (if keterangan contain | TRF, then use text before)
    if (ketUpper.includes("| TRF")) {
      ketUpper = ketUpper.split("| TRF")[0].trim();
    }

    const ketClean = ketUpper.replace(/[^A-Z0-9]/g, '');
    
    // Priority 1: CPS or SYA
    const preferCPS = ketUpper.includes("CPS") || ketUpper.includes("SYA") || ketUpper.includes("SYARIAH");
    // Priority 2: CP, CABANG, CAB.
    const preferCP = ketUpper.includes("CP") || ketUpper.includes("CABANG") || ketUpper.includes("CAB.");

    // Special Logic for BRI Bank/CMS Data (Priority 3)
    if (bankName === 'BRI') {
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, bank: 'BNI' | 'BRI' | 'BSI' | 'BNI_SYSTEM') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (bank === 'BNI') setBniFile(file);
    else if (bank === 'BRI') setBriFile(file);
    else if (bank === 'BSI') setBsiFile(file);
    else if (bank === 'BNI_SYSTEM') setBniSystemFile(file);

    setIsLoading(true);
    setLoadingMessage(`Membaca file ${bank === 'BNI_SYSTEM' ? 'Sistem BNI' : `CMS ${bank}`}...`);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const arrayBuffer = evt.target?.result;
      if (!arrayBuffer) {
        setIsLoading(false);
        return;
      }
      const wb = XLSX.read(new Uint8Array(arrayBuffer as ArrayBuffer), { type: 'array', cellNF: true, raw: true });
      
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
      
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as any[][];
      
      if (bank === 'BNI') {
        parseBankBNI(data);
      } else if (bank === 'BRI') {
        parseBankBRI(data);
      } else if (bank === 'BSI') {
        parseBankBSI(data);
      } else if (bank === 'BNI_SYSTEM') {
        parseBniSystem(data);
      }
      
      setIsLoading(false);
      toast.success(`Berhasil memuat data ${bank === 'BNI_SYSTEM' ? 'Sistem BNI' : `CMS ${bank}`}`);
    };
    reader.readAsArrayBuffer(file);
  };

  const parseBniSystem = (data: any[][]) => {
    const result: BniSystemData[] = [];
    // Start from row 12 as per RekonBNI.tsx parseSistem
    for (let i = 12; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 9) continue;

      const tanggalRaw = row[0]; // Col A
      const docNumber = String(row[5] || "").trim(); // Col F
      const textUtama = String(row[4] || "").trim(); // Col E
      const longText = String(row[11] || "").trim(); // Col L
      const kredit = cleanAmount(row[8]); // Col I (Credit)

      const isCredit = Math.abs(kredit) > 0;
      const startsWith6 = docNumber.startsWith('6');

      if (tanggalRaw && isCredit && startsWith6) {
        let ket = textUtama !== "" ? textUtama : longText;
        
        // Look-ahead for multi-line descriptions
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
              ket += " " + nextKet;
            }
            j++;
          } else {
            break;
          }
        }

        const namaCabang = getCabang(ket, 'BNI');
        
        result.push({
          id: `bni-sys-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket.replace(/\s+/g, ' ').trim(),
          nominal: Math.abs(kredit),
          cabang: namaCabang,
          docNumber: docNumber
        });

        i = j - 1;
      }
    }
    setBniSystemData(result);
  };

  const finalBniData = React.useMemo(() => {
    const result: MokerData[] = [];
    const bniBranches = Array.from(new Set([...bniData.map(d => d.cabang), ...bniSystemData.map(d => d.cabang)])).sort();
    
    bniBranches.forEach(branch => {
      if (branch === '-') return;
      
      const branchCmsData = bniData.filter(d => d.cabang === branch);
      const branchSystemData = bniSystemData.filter(d => d.cabang === branch);
      
      let droppingItems: MokerData[] = [];
      let poolingItems: MokerData[] = branchCmsData.filter(d => d.type === 'pooling');
      
      const totalCmsDropping = branchCmsData.filter(d => d.type === 'dropping').reduce((sum, d) => sum + d.nominal, 0);
      const totalSystemDropping = branchSystemData.reduce((sum, d) => sum + d.nominal, 0);
      
      // Logic 1: Use BNI System Data for dropping if available
      if (branchSystemData.length > 0) {
        droppingItems = branchSystemData.map(sys => ({
          id: `sys-moker-${sys.id}`,
          tanggal: sys.tanggal,
          keterangan: sys.keterangan,
          nominal: sys.nominal,
          cabang: sys.cabang,
          bank: 'BNI',
          type: 'dropping'
        }));
        
        // Logic B: Setoran Moker (System > CMS)
        if (totalSystemDropping > totalCmsDropping) {
          const diff = totalSystemDropping - totalCmsDropping;
          poolingItems.push({
            id: `setoran-moker-${branch}`,
            tanggal: droppingItems[droppingItems.length - 1]?.tanggal || new Date().toISOString().split('T')[0],
            keterangan: branch,
            nominal: diff,
            cabang: branch,
            bank: 'BNI',
            type: 'pooling'
          });
        }
        // Logic A (No Setoran Moker): If System == CMS, ignore as is (already handled by not adding anything)
      } else {
        // No system data, use CMS data as is
        droppingItems = branchCmsData.filter(d => d.type === 'dropping');
      }
      
      result.push(...droppingItems, ...poolingItems);
    });
    
    return result;
  }, [bniData, bniSystemData]);

  const parseBankBNI = (data: any[][]) => {
    const rawResult: MokerData[] = [];
    for (let i = 12; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 25) continue;
      
      const tanggalRaw = row[7];
      let ket = String(row[12] || "").trim();
      const amountRaw = row[21];
      const dcRaw = String(row[23] || "").trim().toUpperCase();
      const amount = cleanAmount(amountRaw);
      
      if (tanggalRaw && !isNaN(amount) && amount > 0) {
        let j = i + 1;
        while (j < data.length) {
          const nextRow = data[j];
          if (!nextRow) break;
          const nextTgl = String(nextRow[7] || "").trim();
          const nextKet = String(nextRow[12] || "").trim();
          if (nextTgl === "" && nextKet !== "") {
            ket += " " + nextKet;
            j++;
          } else break;
        }
        
        const dcFinal = dcRaw.includes("D") ? "D" : (dcRaw.includes("C") ? "C" : "-");
        rawResult.push({
          id: `bni-${i}`,
          tanggal: parseExcelDate(tanggalRaw),
          keterangan: ket.replace(/\s+/g, ' ').trim(),
          nominal: amount,
          cabang: getCabang(ket, 'BNI'),
          bank: 'BNI',
          type: dcFinal === 'D' ? 'dropping' : 'pooling'
        });
        i = j - 1;
      }
    }
    setBniData(rawResult);
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
          cabang: getCabang(ket, 'BRI'),
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
          cabang: getCabang(ket, 'BSI'),
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

  const handleCabangChange = (id: string, newCabang: string, bank: 'BNI' | 'BRI' | 'BSI' | 'BNI_SYSTEM') => {
    if (bank === 'BNI') {
      setBniData(prev => prev.map(item => item.id === id ? { ...item, cabang: newCabang } : item));
    } else if (bank === 'BRI') {
      setBriData(prev => prev.map(item => item.id === id ? { ...item, cabang: newCabang } : item));
    } else if (bank === 'BSI') {
      setBsiData(prev => prev.map(item => item.id === id ? { ...item, cabang: newCabang } : item));
    } else if (bank === 'BNI_SYSTEM') {
      setBniSystemData(prev => prev.map(item => item.id === id ? { ...item, cabang: newCabang } : item));
    }
  };

  const handleSaveMoker = async () => {
    const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
    if (!spreadsheetId) {
      toast.error('ID Spreadsheet belum dikonfigurasi');
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Menyimpan rekap moker...');

    try {
      const allRows = [
        ...finalBniData.map(item => {
          const dropping = item.type === 'dropping' ? item.nominal : 0;
          const pooling = item.type === 'pooling' ? item.nominal : 0;
          const net = dropping - pooling;
          return [item.tanggal, item.bank, item.cabang, dropping, pooling, net];
        }),
        ...briData.map(item => {
          const dropping = item.type === 'dropping' ? item.nominal : 0;
          const pooling = item.type === 'pooling' ? item.nominal : 0;
          const net = dropping - pooling;
          return [item.tanggal, item.bank, item.cabang, dropping, pooling, net];
        }),
        ...bsiData.map(item => {
          const dropping = item.type === 'dropping' ? item.nominal : 0;
          const pooling = item.type === 'pooling' ? item.nominal : 0;
          const net = dropping - pooling;
          return [item.tanggal, item.bank, item.cabang, dropping, pooling, net];
        })
      ];

      if (allRows.length === 0) {
        toast.error('Tidak ada data untuk disimpan');
        setIsLoading(false);
        return;
      }

      const sheetId = await googleSheetsService.getSheetIdByName(spreadsheetId, 'RekapMoker');
      if (sheetId === null) {
        toast.error('Sheet "RekapMoker" tidak ditemukan');
        setIsLoading(false);
        return;
      }

      await googleSheetsService.insertRows(spreadsheetId, sheetId, 1, allRows.length);
      await googleSheetsService.updateData(spreadsheetId, `RekapMoker!A2`, allRows);

      toast.success('Rekap Moker berhasil disimpan');
      addNotification('Simpan Rekap Moker Berhasil', `Berhasil menyimpan ${allRows.length} data rekap moker ke Google Sheets.`, 'success');
      
      // Reset all states
      setBniData([]);
      setBriData([]);
      setBsiData([]);
      setBniSystemData([]);
      setBniFile(null);
      setBriFile(null);
      setBsiFile(null);
      setBniSystemFile(null);
      setStep(1);
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error(`Gagal menyimpan data: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const updateCabang = (bank: 'BNI' | 'BRI' | 'BSI' | 'BNI_SYSTEM', id: string, newCabang: string) => {
    // Handle prefixed IDs for BNI System items in finalBniData
    if (bank === 'BNI' && id.startsWith('sys-moker-')) {
      const originalId = id.replace('sys-moker-', '');
      setBniSystemData(prev => prev.map(item => item.id === originalId ? { ...item, cabang: newCabang } : item));
      return;
    }
    
    if (bank === 'BNI_SYSTEM') {
      setBniSystemData(prev => prev.map(item => item.id === id ? { ...item, cabang: newCabang } : item));
      return;
    }
    const updateFn = (prev: MokerData[]) => prev.map(item => item.id === id ? { ...item, cabang: newCabang } : item);
    if (bank === 'BNI') setBniData(updateFn);
    else if (bank === 'BRI') setBriData(updateFn);
    else if (bank === 'BSI') setBsiData(updateFn);
  };

  const renderBniSystemTable = (data: BniSystemData[]) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
      <div className="px-6 py-4 border-b border-gray-50 bg-indigo-50/50 flex items-center justify-between">
        <h3 className="font-bold text-indigo-800 flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-600" />
          Data Sistem BNI (Outstanding)
        </h3>
        <span className="text-xs font-medium px-2 py-1 bg-white border border-indigo-200 rounded-full text-indigo-500">
          {data.length} Transaksi
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-gray-50/30">
            <tr>
              <th className="px-6 py-3 font-semibold">Tanggal</th>
              <th className="px-6 py-3 font-semibold">Doc Number</th>
              <th className="px-6 py-3 font-semibold">Keterangan</th>
              <th className="px-6 py-3 font-semibold text-right">Nominal</th>
              <th className="px-6 py-3 font-semibold">Cabang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.length > 0 ? data.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4 font-medium text-gray-600">{item.tanggal}</td>
                <td className="px-6 py-4 text-gray-500 font-mono text-xs">{item.docNumber}</td>
                <td className="px-6 py-4 text-gray-500 whitespace-normal break-words min-w-[300px]">{item.keterangan}</td>
                <td className="px-6 py-4 text-right font-bold text-indigo-600">
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(item.nominal)}
                </td>
                <td className="px-6 py-4 min-w-[200px]">
                  <Select
                    options={cabangOptions}
                    value={cabangOptions.find(o => o.value === item.cabang) || { value: item.cabang, label: item.cabang }}
                    onChange={(val) => updateCabang('BNI_SYSTEM', item.id, val?.value || '-')}
                    onInputChange={(val) => {
                      if (val) updateCabang('BNI_SYSTEM', item.id, val);
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
                        backgroundColor: state.isSelected ? '#4f46e5' : state.isFocused ? '#eef2ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151',
                      })
                    }}
                  />
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-400">Belum ada data sistem BNI diunggah</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

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
                <td className="px-6 py-4 text-gray-500 whitespace-normal break-words min-w-[300px]" title={item.keterangan}>{item.keterangan}</td>
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
            {/* Google Sheets connection removed as requested */}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-4">
            {/* BNI System Data Upload */}
            <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center transition-all hover:shadow-md">
              <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
                <Database className="w-7 h-7 text-[#004d40]" />
              </div>
              <h3 className="text-base font-bold text-gray-800 mb-1">Upload Data Sistem BNI</h3>
              <p className="text-[10px] text-gray-500 mb-6">Pilih file Excel dari Sistem BNI (format .xlsx)</p>
              
              <input
                type="file"
                ref={bniSystemInputRef}
                onChange={(e) => handleFileUpload(e, 'BNI_SYSTEM')}
                className="hidden"
                accept=".xlsx,.xls,.csv"
              />
              
              <button 
                onClick={() => bniSystemInputRef.current?.click()}
                className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${bniSystemData.length > 0 ? 'bg-[#004d40] text-white' : 'bg-[#004d40] text-white hover:bg-[#003d33]'}`}
              >
                {bniSystemData.length > 0 ? <CheckCircle className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                {bniSystemData.length > 0 ? 'Terunggah' : 'Pilih File Bank'}
              </button>
              {bniSystemFile && <p className="mt-2 text-[10px] text-[#004d40] font-medium truncate w-full px-2">{bniSystemFile.name}</p>}
            </div>

            {(['BNI', 'BRI', 'BSI'] as const).map((bank) => (
              <div key={bank} className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center transition-all hover:shadow-md">
                <div className="w-14 h-14 bg-[#F7FBE1] rounded-full flex items-center justify-center mb-4">
                  <FileSpreadsheet className="w-7 h-7 text-[#8A9A00]" />
                </div>
                <h3 className="text-base font-bold text-gray-800 mb-1">Upload Data CMS {bank}</h3>
                <p className="text-[10px] text-gray-500 mb-6">Pilih file Excel dari Mutasi CMS {bank} (format .xlsx)</p>
                
                <input
                  type="file"
                  ref={bank === 'BNI' ? bniInputRef : bank === 'BRI' ? briInputRef : bsiInputRef}
                  onChange={(e) => handleFileUpload(e, bank)}
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                />
                
                <button 
                  onClick={() => (bank === 'BNI' ? bniInputRef : bank === 'BRI' ? briInputRef : bsiInputRef).current?.click()}
                  className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 bg-[#C4D600] text-black hover:bg-[#AAB800]`}
                >
                  {(bank === 'BNI' ? bniData : bank === 'BRI' ? briData : bsiData).length > 0 ? <CheckCircle className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  {(bank === 'BNI' ? bniData : bank === 'BRI' ? briData : bsiData).length > 0 ? 'Terunggah' : 'Pilih File Bank'}
                </button>
                {(bank === 'BNI' ? bniFile : bank === 'BRI' ? briFile : bsiFile) && (
                  <p className="mt-2 text-[10px] text-[#8A9A00] font-medium truncate w-full px-2">
                    {(bank === 'BNI' ? bniFile : bank === 'BRI' ? briFile : bsiFile)?.name}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-12">
            <button
              onClick={() => {
                if (hasDateInconsistency) {
                  toast.error("Tidak dapat melanjutkan: Terdapat ketidakkonsistenan tanggal antar file!");
                  return;
                }
                setStep(2);
              }}
              disabled={(bniData.length === 0 && briData.length === 0 && bsiData.length === 0) || hasDateInconsistency}
              className={`px-8 py-4 rounded-2xl font-bold text-sm flex items-center gap-3 transition-all ${
                (bniData.length > 0 || briData.length > 0 || bsiData.length > 0) && !hasDateInconsistency
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
              {bniSystemData.length > 0 && renderBniSystemTable(bniSystemData)}
              {renderTable('BNI', finalBniData)}
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
