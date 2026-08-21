import { ChangeEvent, ClipboardEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Keyboard,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  WalletCards,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Select, { type StylesConfig } from 'react-select';
import * as XLSX from 'xlsx';
import {
  AlignmentType,
  BorderStyle,
  Document,
  PageOrientation,
  Packer,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { canModifyDatabase, type RoleDatabasePermissionMap } from '../constants/databasePermissions';
import { googleSheetsService } from '../services/googleSheetsService';
import { mataAnggaranService } from '../services/mataAnggaranService';
import type { MataAnggaranMaster } from '../data/mataAnggaranSeed';
import { defaultInputDroppingSigners, penandatanganService, type InputDroppingSigners } from '../services/penandatanganService';

interface InputDroppingProps {
  currentUser?: any;
  roleDatabasePermissionMap?: RoleDatabasePermissionMap;
}

interface DroppingRow {
  id: string;
  allocationId: string;
  sourceRow: number;
  tanggal: string;
  kodeOutlet: string;
  namaOutlet: string;
  kebutuhanAnggaran: string;
  mataAnggaran: string;
  kodeActivity: string;
  nominalPersetujuan: number;
  verified: boolean;
  errors: string[];
}

type EditableField = keyof Pick<
  DroppingRow,
  'tanggal' | 'kodeOutlet' | 'namaOutlet' | 'kebutuhanAnggaran' | 'mataAnggaran' | 'kodeActivity' | 'nominalPersetujuan'
>;

type InputMode = 'direct' | 'upload';
type SelectOption = { value: string; label: string };

const SHEET_NAME = 'DataAlokasi';
const HEADERS = [
  'Tanggal',
  'Kode Outlet',
  'Nama Outlet',
  'Kebutuhan Anggaran',
  'Mata Anggaran',
  'Kode Activity',
  'Nominal Pengajuan',
];

const UPLOAD_HEADERS = HEADERS;
const SHEET_HEADERS = [
  ...HEADERS,
  'Nominal Persetujuan',
  'Status Persetujuan',
  'Allocation ID',
  'Batch ID',
  'Approval Updated At',
];

const createId = (prefix: string) => {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
};

const createBatchId = () => {
  const date = new Date();
  const datePart = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `BAT-${datePart}-${createId('').replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`;
};

const normalizeHeader = (value: unknown) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const normalizeMasterValue = (value: unknown) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .toUpperCase();

const UPLOAD_HEADER_ALIASES = [
  ['tanggal'],
  ['kodeoutlet'],
  ['namaoutlet'],
  ['kebutuhananggaran'],
  ['mataanggaran'],
  ['kodeactivity', 'kodeaktivitas'],
  ['nominalpengajuan'],
];

const formatDateParts = (year: number, month: number, day: number) => (
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const parseExcelDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    return parts ? formatDateParts(parts.y, parts.m, parts.d) : '';
  }

  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dmy = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  if (dmy) return formatDateParts(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return '';
};

const parseAmount = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  let text = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!text) return Number.NaN;

  if (text.includes('.') && text.includes(',')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    const parts = text.split(',');
    text = parts.length > 2 || parts[parts.length - 1].length === 3
      ? text.replace(/,/g, '')
      : text.replace(',', '.');
  } else if (text.includes('.')) {
    const parts = text.split('.');
    if (parts.length > 2 || parts[parts.length - 1].length === 3) text = text.replace(/\./g, '');
  }

  const amount = Number(text);
  return Number.isFinite(amount) ? amount : Number.NaN;
};

const validateRow = (row: Omit<DroppingRow, 'errors'>) => {
  const errors: string[] = [];
  if (!parseExcelDate(row.tanggal)) errors.push('Tanggal tidak valid');
  if (!row.kodeOutlet.trim()) errors.push('Kode Outlet wajib diisi');
  if (!row.namaOutlet.trim()) errors.push('Nama Outlet wajib diisi');
  if (!row.kebutuhanAnggaran.trim()) errors.push('Kebutuhan Anggaran wajib diisi');
  if (!row.mataAnggaran.trim()) errors.push('Mata Anggaran wajib diisi');
  if (!row.kodeActivity.trim()) errors.push('Kode Activity wajib diisi');
  if (!Number.isFinite(row.nominalPersetujuan) || row.nominalPersetujuan < 0) {
    errors.push('Nominal Pengajuan tidak valid');
  }
  return errors;
};

const validateMasterMapping = (row: DroppingRow, master: MataAnggaranMaster[]) => {
  const errors: string[] = [];
  if (!row.mataAnggaran.trim() && !row.kodeActivity.trim()) return errors;
  if (!master.length) return ['Master Mata Anggaran belum tersedia'];

  const normalizedMataAnggaran = normalizeMasterValue(row.mataAnggaran);
  const matchingMataAnggaran = master.filter(item => (
    normalizeMasterValue(item.mataAnggaran) === normalizedMataAnggaran
  ));
  if (!matchingMataAnggaran.length) {
    errors.push('Mata Anggaran tidak sesuai master');
    if (row.kodeActivity.trim()) errors.push('Kode Activity tidak sesuai Mata Anggaran');
    return errors;
  }

  const activityIsValid = matchingMataAnggaran.some(item => (
    normalizeMasterValue(item.kodeActivity) === normalizeMasterValue(row.kodeActivity)
  ));
  if (row.kodeActivity.trim() && !activityIsValid) {
    errors.push('Kode Activity tidak sesuai Mata Anggaran');
  }
  return errors;
};

const withValidation = (row: Omit<DroppingRow, 'errors'>): DroppingRow => ({
  ...row,
  tanggal: parseExcelDate(row.tanggal) || row.tanggal,
  errors: validateRow(row),
});

const toInputValues = (row: DroppingRow) => [
  row.tanggal,
  row.kodeOutlet.trim(),
  row.namaOutlet.trim(),
  row.kebutuhanAnggaran.trim(),
  row.mataAnggaran.trim(),
  row.kodeActivity.trim(),
  row.nominalPersetujuan,
];

const toSheetRow = (row: DroppingRow, batchId: string) => [
  ...toInputValues(row),
  '',
  'PENDING',
  row.allocationId,
  batchId,
  '',
];

const formatNumber = (value: number) => (
  Number.isFinite(value) ? new Intl.NumberFormat('id-ID').format(value) : '-'
);

const isRowEmpty = (row: DroppingRow) => (
  !row.tanggal &&
  !row.kodeOutlet.trim() &&
  !row.namaOutlet.trim() &&
  !row.kebutuhanAnggaran.trim() &&
  !row.mataAnggaran.trim() &&
  !row.kodeActivity.trim() &&
  !Number.isFinite(row.nominalPersetujuan)
);

const EDITABLE_FIELDS: EditableField[] = [
  'tanggal',
  'kodeOutlet',
  'namaOutlet',
  'kebutuhanAnggaran',
  'mataAnggaran',
  'kodeActivity',
  'nominalPersetujuan',
];

const createBlankRow = (sourceRow = 1): DroppingRow => withValidation({
  id: `${Date.now()}-${sourceRow}-${Math.random().toString(36).slice(2)}`,
  allocationId: createId('ALC'),
  sourceRow,
  tanggal: '',
  kodeOutlet: '',
  namaOutlet: '',
  kebutuhanAnggaran: '',
  mataAnggaran: '',
  kodeActivity: '',
  nominalPersetujuan: Number.NaN,
  verified: false,
});

const directSelectStyles: StylesConfig<SelectOption, false> = {
  control: base => ({
    ...base,
    minHeight: 28,
    height: 28,
    border: 0,
    borderRadius: 0,
    boxShadow: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  }),
  valueContainer: base => ({ ...base, padding: '0 8px', whiteSpace: 'nowrap' }),
  input: base => ({ ...base, margin: 0, padding: 0 }),
  indicatorsContainer: base => ({ ...base, height: 28 }),
  dropdownIndicator: base => ({ ...base, padding: 4 }),
  clearIndicator: base => ({ ...base, padding: 4 }),
  indicatorSeparator: () => ({ display: 'none' }),
  menu: base => ({ ...base, zIndex: 50, minWidth: 320 }),
  option: (base, state) => ({
    ...base,
    cursor: 'pointer',
    fontSize: 11,
    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#ecfdf5' : '#ffffff',
    color: state.isSelected ? '#ffffff' : '#374151',
  }),
};

const reviewSelectStyles = (invalid: boolean): StylesConfig<SelectOption, false> => ({
  control: (base, state) => ({
    ...base,
    minHeight: 36,
    borderColor: invalid ? '#ef4444' : state.isFocused ? '#009B4F' : '#e5e7eb',
    boxShadow: invalid
      ? '0 0 0 1px #ef4444'
      : state.isFocused ? '0 0 0 1px rgba(0, 155, 79, 0.2)' : 'none',
    backgroundColor: invalid ? '#fef2f2' : '#ffffff',
    cursor: 'pointer',
    '&:hover': { borderColor: invalid ? '#dc2626' : '#009B4F' },
  }),
  valueContainer: base => ({ ...base, padding: '0 8px', whiteSpace: 'nowrap' }),
  input: base => ({ ...base, margin: 0, padding: 0 }),
  indicatorsContainer: base => ({ ...base, height: 36 }),
  dropdownIndicator: base => ({ ...base, padding: 6 }),
  clearIndicator: base => ({ ...base, padding: 6 }),
  indicatorSeparator: () => ({ display: 'none' }),
  menu: base => ({ ...base, zIndex: 50, minWidth: 320 }),
  option: (base, state) => ({
    ...base,
    cursor: 'pointer',
    fontSize: 11,
    backgroundColor: state.isSelected ? '#009B4F' : state.isFocused ? '#ecfdf5' : '#ffffff',
    color: state.isSelected ? '#ffffff' : '#374151',
  }),
});

export function InputDropping({ currentUser, roleDatabasePermissionMap = {} }: InputDroppingProps) {
  const [mode, setMode] = useState<InputMode>('direct');
  const [batchId, setBatchId] = useState(createBatchId);
  const [step, setStep] = useState<1 | 2>(1);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<DroppingRow[]>([]);
  const [directRows, setDirectRows] = useState<DroppingRow[]>(() => Array.from({ length: 10 }, (_, index) => createBlankRow(index + 1)));
  const [mataAnggaranMaster, setMataAnggaranMaster] = useState<MataAnggaranMaster[]>([]);
  const [signers, setSigners] = useState<InputDroppingSigners>(defaultInputDroppingSigners);
  const [nodinFingerprint, setNodinFingerprint] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingNodin, setIsCreatingNodin] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spreadsheetId = import.meta.env.VITE_REKON_SPREADSHEET_ID;
  const canSave = canModifyDatabase(currentUser?.role, 'anggaran', 'edit', roleDatabasePermissionMap);

  const activeRows = mode === 'direct' ? directRows : rows;
  const rowsToSave = useMemo(
    () => mode === 'direct' ? activeRows.filter(row => !isRowEmpty(row)) : activeRows,
    [activeRows, mode],
  );
  const validationErrorsById = useMemo(() => new Map(rowsToSave.map(row => [
    row.id,
    [...row.errors, ...validateMasterMapping(row, mataAnggaranMaster)],
  ])), [rowsToSave, mataAnggaranMaster]);
  const invalidCount = useMemo(() => rowsToSave.filter(row => (
    (validationErrorsById.get(row.id)?.length || 0) > 0
  )).length, [rowsToSave, validationErrorsById]);
  const totalNominal = useMemo(
    () => rowsToSave.reduce((total, row) => total + (Number.isFinite(row.nominalPersetujuan) ? row.nominalPersetujuan : 0), 0),
    [rowsToSave],
  );
  const mataAnggaranOptions = useMemo(() => Array.from(new Set(mataAnggaranMaster.map(item => item.mataAnggaran)))
    .map(value => ({ value, label: value })), [mataAnggaranMaster]);
  const currentFingerprint = useMemo(() => JSON.stringify({
    mode,
    batchId,
    rows: rowsToSave.map(row => [...toInputValues(row), row.verified]),
    signers,
  }), [batchId, mode, rowsToSave, signers]);
  const hasCurrentNodin = nodinFingerprint === currentFingerprint;

  useEffect(() => {
    Promise.all([
      mataAnggaranService.getAll(),
      penandatanganService.getInputDropping(),
    ])
      .then(([mataAnggaran, signerData]) => {
        setMataAnggaranMaster(mataAnggaran);
        setSigners(signerData);
      })
      .catch(error => {
        console.error('Input Dropping master load error:', error);
        toast.error('Gagal memuat master Input Dropping');
      });
  }, []);

  const downloadFormat = () => {
    const worksheet = XLSX.utils.aoa_to_sheet([UPLOAD_HEADERS]);
    worksheet['!cols'] = [
      { wch: 14 },
      { wch: 18 },
      { wch: 28 },
      { wch: 35 },
      { wch: 24 },
      { wch: 20 },
      { wch: 24 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME);
    XLSX.writeFile(workbook, 'Format_Input_Dropping.xlsx');
    toast.success('Format Input Dropping berhasil diunduh');
  };

  const readFile = async (selectedFile: File) => {
    if (!/\.xlsx?$/i.test(selectedFile.name)) {
      toast.error('File harus berformat .xlsx atau .xls');
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 10 MB');
      return;
    }

    setIsReading(true);
    try {
      const workbook = XLSX.read(await selectedFile.arrayBuffer(), { type: 'array', cellDates: true });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error('Worksheet pertama tidak ditemukan');

      const data = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '', raw: true });
      const headerIndex = data.slice(0, 20).findIndex(row => {
        const normalized = row.map(normalizeHeader);
        return UPLOAD_HEADER_ALIASES.every(aliases => aliases.some(header => normalized.includes(header)));
      });
      if (headerIndex < 0) {
        throw new Error(`Header wajib: ${UPLOAD_HEADERS.join(', ')}`);
      }

      const normalizedHeader = data[headerIndex].map(normalizeHeader);
      const columnIndex = UPLOAD_HEADER_ALIASES.map(aliases => (
        normalizedHeader.findIndex(header => aliases.includes(header))
      ));
      const parsedRows = data.slice(headerIndex + 1)
        .map((source, index) => ({ source, sourceRow: headerIndex + index + 2 }))
        .filter(({ source }) => columnIndex.some(column => String(source[column] ?? '').trim()))
        .map(({ source, sourceRow }, index) => withValidation({
          id: `${Date.now()}-${sourceRow}-${index}`,
          allocationId: createId('ALC'),
          sourceRow,
          tanggal: parseExcelDate(source[columnIndex[0]]),
          kodeOutlet: String(source[columnIndex[1]] ?? '').trim(),
          namaOutlet: String(source[columnIndex[2]] ?? '').trim(),
          kebutuhanAnggaran: String(source[columnIndex[3]] ?? '').trim(),
          mataAnggaran: String(source[columnIndex[4]] ?? '').trim(),
          kodeActivity: String(source[columnIndex[5]] ?? '').trim(),
          nominalPersetujuan: parseAmount(source[columnIndex[6]]),
          verified: false,
        }));

      if (!parsedRows.length) throw new Error('Tidak ada baris data pada file');
      setFile(selectedFile);
      setRows(parsedRows);
      toast.success(`${parsedRows.length} baris berhasil dibaca`);
    } catch (error: any) {
      setFile(null);
      setRows([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.error(`Gagal membaca file: ${error.message}`);
    } finally {
      setIsReading(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) void readFile(selectedFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const selectedFile = event.dataTransfer.files?.[0];
    if (selectedFile) void readFile(selectedFile);
  };

  const resetUpload = () => {
    setStep(1);
    setFile(null);
    setRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateRow = (id: string, field: EditableField, value: string) => {
    const setActiveRows = mode === 'direct' ? setDirectRows : setRows;
    setActiveRows(current => current.map(row => {
      if (row.id !== id) return row;
      const next = {
        ...row,
        [field]: field === 'nominalPersetujuan' ? (value === '' ? Number.NaN : Number(value)) : value,
      } as DroppingRow;
      return { ...next, errors: validateRow(next) };
    }));
  };

  const updateMataAnggaran = (id: string, value: string) => {
    const setActiveRows = mode === 'direct' ? setDirectRows : setRows;
    setActiveRows(current => current.map(row => {
      if (row.id !== id) return row;
      const availableActivities = mataAnggaranMaster
        .filter(item => normalizeMasterValue(item.mataAnggaran) === normalizeMasterValue(value))
        .map(item => item.kodeActivity);
      const next = {
        ...row,
        mataAnggaran: value,
        kodeActivity: availableActivities.some(activity => (
          normalizeMasterValue(activity) === normalizeMasterValue(row.kodeActivity)
        )) ? row.kodeActivity : '',
      };
      return { ...next, errors: validateRow(next) };
    }));
  };

  const deleteRow = (id: string) => {
    const setActiveRows = mode === 'direct' ? setDirectRows : setRows;
    setActiveRows(current => current.filter(row => row.id !== id));
  };

  const toggleVerification = (id: string) => {
    const setActiveRows = mode === 'direct' ? setDirectRows : setRows;
    setActiveRows(current => current.map(row => row.id === id ? { ...row, verified: !row.verified } : row));
  };

  const addDirectRow = () => {
    setDirectRows(current => [...current, createBlankRow(current.length + 1)]);
  };

  const handleDirectPaste = (event: ClipboardEvent<HTMLElement>, rowIndex: number, field: EditableField) => {
    if (mode !== 'direct') return;
    const pastedText = event.clipboardData.getData('text');
    if (!pastedText.includes('\t') && !pastedText.includes('\n')) return;

    event.preventDefault();
    const clipboardRows = pastedText.replace(/\r/g, '').split('\n').filter(row => row.trim() !== '');
    if (clipboardRows.length > 100) toast.error('Maksimal 100 baris setiap kali paste');

    const pastedRows = clipboardRows.slice(0, 100).map(row => row.split('\t'));
    const startColumn = EDITABLE_FIELDS.indexOf(field);
    setDirectRows(current => {
      const next = [...current];
      while (next.length < rowIndex + pastedRows.length) next.push(createBlankRow(next.length + 1));

      pastedRows.forEach((columns, rowOffset) => {
        const targetIndex = rowIndex + rowOffset;
        let target = { ...next[targetIndex] };
        columns.forEach((cell, columnOffset) => {
          const targetField = EDITABLE_FIELDS[startColumn + columnOffset];
          if (!targetField) return;
          const value = cell.trim();
          target = {
            ...target,
            [targetField]: targetField === 'nominalPersetujuan' ? parseAmount(value) : value,
          };
        });
        next[targetIndex] = withValidation(target);
      });

      return next;
    });
    toast.success(`${pastedRows.length} baris berhasil ditempel`);
  };

  const continueToReview = () => {
    if (!file || !rows.length) return toast.error('Pilih file Excel terlebih dahulu');
    setStep(2);
  };

  const createNodin = async () => {
    if (!rowsToSave.length) return toast.error('Tidak ada data yang dapat dibuatkan Nodin');
    if (invalidCount > 0) return toast.error(`Perbaiki ${invalidCount} baris yang belum valid sebelum membuat Nodin`);

    setIsCreatingNodin(true);
    const toastId = toast.loading('Membuat dokumen Nota Dinas...');
    try {
      const groupedRows = Array.from(rowsToSave.reduce((groups, row) => {
        const current = groups.get(row.mataAnggaran) || [];
        current.push(row);
        groups.set(row.mataAnggaran, current);
        return groups;
      }, new Map<string, DroppingRow[]>()).entries());
      const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
      const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      const noBorder = {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      };
      const textRun = (text: string, bold = false, size = 18) => new TextRun({ text, bold, size, font: 'Arial' });
      const cell = (
        text: string,
        options: { bold?: boolean; align?: typeof AlignmentType[keyof typeof AlignmentType]; span?: number; width?: number; fill?: string; size?: number } = {},
      ) => new TableCell({
        columnSpan: options.span,
        width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
        borders: cellBorders,
        verticalAlign: VerticalAlign.CENTER,
        shading: options.fill ? { fill: options.fill } : undefined,
        margins: { top: 70, bottom: 70, left: 80, right: 80 },
        children: [new Paragraph({
          alignment: options.align || AlignmentType.LEFT,
          spacing: { before: 0, after: 0 },
          children: [textRun(text, options.bold, options.size || 16)],
        })],
      });
      const headerCell = (text: string, width?: number) => cell(text, {
        bold: true,
        align: AlignmentType.CENTER,
        width,
        fill: 'D9EAD3',
        size: 15,
      });
      const metadataRows = [
        ['Kepada', 'Yth. Deputy Operasional'],
        ['Dari', 'Kepala Departemen Logistik & Umum Kantor Wilayah VI'],
        ['Tanggal', new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())],
        ['Batch ID', batchId],
        ['Lampiran', '-'],
        ['Sifat', 'Biasa'],
        ['Perihal', 'Otorisasi Anggaran Cabang'],
      ].map(([label, value]) => new TableRow({ children: [
        new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, borders: noBorder, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [new Paragraph({ spacing: { after: 0 }, children: [textRun(label, label === 'Perihal', 20)] })] }),
        new TableCell({ width: { size: 3, type: WidthType.PERCENTAGE }, borders: noBorder, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [new Paragraph({ spacing: { after: 0 }, children: [textRun(':', false, 20)] })] }),
        new TableCell({ width: { size: 82, type: WidthType.PERCENTAGE }, borders: noBorder, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [new Paragraph({ spacing: { after: 0 }, children: [textRun(value, label === 'Perihal', 20)] })] }),
      ] }));

      const nodinTableRows: TableRow[] = [new TableRow({
        tableHeader: true,
        children: [
          headerCell('No', 6),
          headerCell('Nama Outlet', 22),
          headerCell('Kebutuhan Anggaran', 25),
          headerCell('Mata Anggaran', 20),
          headerCell('Kode Activity', 15),
          headerCell('Nominal Pengajuan', 12),
        ],
      })];
      groupedRows.forEach(([mataAnggaran, group]) => {
        nodinTableRows.push(new TableRow({ children: [cell(`${mataAnggaran}`, { bold: true, span: 6, fill: 'EEF6F3' })] }));
        group.forEach((row, index) => nodinTableRows.push(new TableRow({ children: [
          cell(String(index + 1), { align: AlignmentType.CENTER }),
          cell(`${row.kodeOutlet} - ${row.namaOutlet}`),
          cell(row.kebutuhanAnggaran),
          cell(row.mataAnggaran),
          cell(row.kodeActivity),
          cell(formatNumber(row.nominalPersetujuan), { align: AlignmentType.RIGHT }),
        ] })));
        const groupTotal = group.reduce((sum, row) => sum + row.nominalPersetujuan, 0);
        nodinTableRows.push(new TableRow({ children: [
          cell('', {}),
          cell(`Total ${mataAnggaran}`, { bold: true, span: 4, align: AlignmentType.RIGHT }),
          cell(formatNumber(groupTotal), { bold: true, align: AlignmentType.RIGHT }),
        ] }));
      });

      const recapRows: TableRow[] = [new TableRow({
        tableHeader: true,
        children: [
          headerCell('No', 5),
          headerCell('Tanggal', 10),
          headerCell('Kode Outlet', 11),
          headerCell('Nama Outlet', 16),
          headerCell('Kebutuhan Anggaran', 22),
          headerCell('Kode Activity', 16),
          headerCell('Nominal Pengajuan', 12),
          headerCell('Keterangan', 8),
        ],
      })];
      groupedRows.forEach(([mataAnggaran, group]) => {
        recapRows.push(new TableRow({ children: [cell(`${mataAnggaran}`, { bold: true, span: 8, fill: 'EEF6F3' })] }));
        group.forEach((row, index) => recapRows.push(new TableRow({ children: [
          cell(String(index + 1), { align: AlignmentType.CENTER }),
          cell(row.tanggal, { align: AlignmentType.CENTER }),
          cell(row.kodeOutlet),
          cell(row.namaOutlet),
          cell(row.kebutuhanAnggaran),
          cell(row.kodeActivity),
          cell(formatNumber(row.nominalPersetujuan), { align: AlignmentType.RIGHT }),
          cell(row.verified ? 'Verified' : 'Not Verified', { align: AlignmentType.CENTER }),
        ] })));
        const groupTotal = group.reduce((sum, row) => sum + row.nominalPersetujuan, 0);
        recapRows.push(new TableRow({ children: [
          cell('', {}),
          cell(`Total ${mataAnggaran}`, { bold: true, span: 5, align: AlignmentType.RIGHT }),
          cell(formatNumber(groupTotal), { bold: true, align: AlignmentType.RIGHT }),
          cell('', {}),
        ] }));
      });

      const signatures = [
        ['Disetujui Oleh', signers.disetujuiOleh],
        ['Diperiksa Oleh', signers.diperiksaOleh],
        ['Dibuat Oleh', signers.dibuatOleh],
      ];
      const signatureTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [new TableRow({ children: signatures.map(([label, name]) => new TableCell({
          width: { size: 33.33, type: WidthType.PERCENTAGE },
          borders: noBorder,
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 850 }, children: [textRun(label, true, 18)] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: name || '(Nama Penandatangan)', bold: true, underline: {}, size: 18, font: 'Arial' })] }),
          ],
        })) })],
      });

      const document = new Document({
        styles: { default: { document: { run: { font: 'Arial', size: 20 }, paragraph: { spacing: { after: 0 } } } } },
        sections: [
          {
            properties: { page: { size: { orientation: PageOrientation.PORTRAIT }, margin: { top: 700, right: 850, bottom: 700, left: 850 } } },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: 'NOTA DINAS', bold: true, underline: {}, size: 28, font: 'Arial' })] }),
              new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: metadataRows }),
              new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000' } }, spacing: { before: 80, after: 180 }, children: [] }),
              new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 }, children: [textRun('Sehubungan dengan masuknya permohonan dari Kantor Cabang, dengan ini diajukan otorisasi anggaran dengan rincian sebagai berikut:', false, 20)] }),
              new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: nodinTableRows }),
              new Paragraph({ spacing: { before: 260, after: 650 }, children: [textRun('Demikian disampaikan, atas persetujuan Bapak kami ucapkan terima kasih.', false, 20)] }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                layout: TableLayoutType.FIXED,
                rows: [new TableRow({ children: [
                  new TableCell({ width: { size: 58, type: WidthType.PERCENTAGE }, borders: cellBorders, children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: thinBorder }, children: [textRun('Disposisi:', true, 20)] }),
                    new Paragraph({ spacing: { after: 1200 }, children: [] }),
                  ] }),
                  new TableCell({ width: { size: 42, type: WidthType.PERCENTAGE }, borders: noBorder, children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1050 }, children: [
                      textRun('Kepala Departemen Logistik & Umum', true, 20),
                      new TextRun({ text: 'Kantor Wilayah VI', break: 1, bold: true, size: 20, font: 'Arial' }),
                    ] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: signers.diperiksaOleh || '(Nama Penandatangan)', bold: true, underline: {}, size: 20, font: 'Arial' })] }),
                  ] }),
                ] })],
              }),
            ],
          },
          {
            properties: { type: SectionType.NEXT_PAGE, page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 650, right: 650, bottom: 650, left: 650 } } },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [textRun('REKAPITULASI DROPPING ANGGARAN', true, 26)] }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 220 }, children: [textRun('Departemen Logistik - Bagian Pengadaan dan Logistik', true, 19)] }),
              new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: recapRows }),
              new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 120, after: 300 }, children: [textRun(`Total Keseluruhan: Rp ${formatNumber(totalNominal)}`, true, 18)] }),
              signatureTable,
            ],
          },
        ],
      });

      const blob = await Packer.toBlob(document);
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `Nota_Dinas_Dropping_Anggaran_${batchId}.docx`;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setNodinFingerprint(currentFingerprint);
      toast.success('Nota Dinas berhasil dibuat. Tombol Simpan Data telah diaktifkan.', { id: toastId });
    } catch (error: any) {
      console.error('Nodin generation error:', error);
      toast.error(`Gagal membuat Nota Dinas: ${error.message}`, { id: toastId });
    } finally {
      setIsCreatingNodin(false);
    }
  };

  const saveData = async () => {
    if (!canSave) return toast.error('Anda tidak memiliki akses edit untuk database Anggaran');
    if (!rowsToSave.length) return toast.error('Tidak ada data yang akan disimpan');
    if (invalidCount > 0) return toast.error(`Perbaiki ${invalidCount} baris yang belum valid`);
    if (!hasCurrentNodin) return toast.error('Buat Nodin terlebih dahulu sebelum menyimpan data');
    if (!window.navigator.onLine) return toast.error('Koneksi internet diperlukan untuk menyimpan data');
    if (!spreadsheetId) return toast.error('Spreadsheet ID belum dikonfigurasi');

    setIsSaving(true);
    const toastId = toast.loading(`Menyimpan ${rowsToSave.length} baris Data Alokasi...`);
    try {
      await googleSheetsService.ensureSheet(spreadsheetId, SHEET_NAME);
      await googleSheetsService.updateData(spreadsheetId, `${SHEET_NAME}!A1:L1`, [SHEET_HEADERS]);
      await googleSheetsService.appendData(spreadsheetId, `${SHEET_NAME}!A:L`, rowsToSave.map(row => toSheetRow(row, batchId)));
      toast.success(`${rowsToSave.length} baris berhasil disimpan dengan Batch ID ${batchId}`, { id: toastId });
      setBatchId(createBatchId());
      setNodinFingerprint(null);
      if (mode === 'direct') {
        setDirectRows(Array.from({ length: 10 }, (_, index) => createBlankRow(index + 1)));
      } else {
        resetUpload();
      }
    } catch (error: any) {
      toast.error(`Gagal menyimpan Data Alokasi: ${error.message}`, { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#009B4F]/10 text-[#009B4F]">
            <WalletCards className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-800">Input Dropping</h1>
            <p className="text-sm text-gray-500">Input langsung atau upload data alokasi anggaran sebelum disimpan.</p>
          </div>
        </div>
      </div>

      <div className="flex w-fit rounded-xl bg-gray-100 p-1">
        {([
          { id: 'direct' as const, label: 'Direct', icon: Keyboard },
          { id: 'upload' as const, label: 'Upload', icon: Upload },
        ]).map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={`flex min-w-36 cursor-pointer items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition-all ${mode === tab.id ? 'bg-white text-[#009B4F] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {mode === 'upload' && (
        <div className="flex items-center gap-4 px-1">
          <div className="flex items-center gap-2 text-[#009B4F]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#009B4F] text-sm font-black text-white">1</span>
            <span className="text-sm font-bold">Upload File</span>
          </div>
          <div className={`h-0.5 w-16 ${step === 2 ? 'bg-[#009B4F]' : 'bg-gray-200'}`} />
          <div className={`flex items-center gap-2 ${step === 2 ? 'text-[#009B4F]' : 'text-gray-400'}`}>
            <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${step === 2 ? 'bg-[#009B4F] text-white' : 'bg-gray-200 text-gray-500'}`}>2</span>
            <span className="text-sm font-bold">Review Dropping</span>
          </div>
        </div>
      )}

      {mode === 'upload' && step === 1 ? (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-3 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-black text-gray-800">Upload Data Dropping</h2>
              <p className="mt-1 text-xs text-gray-500">Gunakan format yang disediakan agar seluruh kolom terbaca dengan benar.</p>
            </div>
            <button
              type="button"
              onClick={downloadFormat}
              className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#009B4F] px-4 text-xs font-bold text-[#009B4F] transition-colors hover:bg-emerald-50"
            >
              <Download className="h-4 w-4" />
              Download Format
            </button>
          </div>

          <div className="p-6">
            <div
              onDragEnter={event => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={event => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`flex min-h-72 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${isDragging ? 'border-[#009B4F] bg-emerald-50' : file ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200 bg-gray-50/60'}`}
            >
              <div className={`flex h-16 w-16 items-center justify-center rounded-full ${file ? 'bg-emerald-100 text-[#009B4F]' : 'bg-white text-gray-400 shadow-sm'}`}>
                {isReading ? <RefreshCw className="h-8 w-8 animate-spin" /> : file ? <CheckCircle2 className="h-8 w-8" /> : <Upload className="h-8 w-8" />}
              </div>
              <h3 className="mt-4 text-base font-black text-gray-800">
                {isReading ? 'Membaca file...' : file ? file.name : 'Tarik file Excel ke area ini'}
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                {file ? `${rows.length} baris ditemukan, ${invalidCount} perlu diperbaiki` : 'atau pilih file dari perangkat Anda (.xlsx / .xls, maksimal 10 MB)'}
              </p>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileInput} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isReading}
                className="mt-5 flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-[#009B4F] px-5 text-xs font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-[#008543] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {file ? 'Ganti File' : 'Pilih File'}
              </button>
            </div>
          </div>

          <div className="flex justify-end border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={continueToReview}
              disabled={!file || !rows.length || isReading}
              className="flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-[#009B4F] px-6 text-sm font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-[#008543] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
            >
              Lanjut Review Dropping
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-3 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-center">
            <div>
              <h2 className="text-lg font-black text-gray-800">{mode === 'direct' ? 'Input Dropping Direct' : 'Review Dropping'}</h2>
              <p className="mt-1 text-xs text-gray-500">
                {mode === 'direct'
                  ? 'Isi data langsung atau paste beberapa baris dari Excel mulai dari sel yang dipilih.'
                  : 'Periksa dan koreksi data sebelum disimpan ke sheet DataAlokasi.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">{rowsToSave.length - invalidCount} Valid</span>
              <span className={`rounded-lg px-3 py-2 ${invalidCount ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-400'}`}>{invalidCount} Tidak Valid</span>
              <span className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700">Total Rp {formatNumber(totalNominal)}</span>
            </div>
          </div>

          <div className="min-h-[360px] flex-1 overflow-auto bg-gray-50/30">
            <table className="w-full min-w-[1500px] border-collapse text-[12px]">
              <thead className="sticky top-0 z-20 bg-[#005245] text-white">
                <tr>
                  <th className="w-14 border-r border-[#004237] px-3 py-3 text-center text-[9px] font-black uppercase">No</th>
                  {HEADERS.map(header => (
                    <th key={header} className={`border-r border-[#004237] px-3 py-3 text-[9px] font-black uppercase ${header === 'Nominal Pengajuan' ? 'text-right' : 'text-left'}`}>
                      {header}
                    </th>
                  ))}
                  <th className="w-24 border-r border-[#004237] px-3 py-3 text-center text-[9px] font-black uppercase">Verifikasi</th>
                  {mode !== 'direct' && <th className="w-44 px-3 py-3 text-center text-[9px] font-black uppercase">Validasi</th>}
                  <th className="w-16 px-3 py-3 text-center text-[9px] font-black uppercase">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {activeRows.map((row, index) => {
                  const isEmpty = mode === 'direct' && isRowEmpty(row);
                  const rowErrors = validationErrorsById.get(row.id) || row.errors;
                  const mataAnggaranInvalid = !row.mataAnggaran.trim()
                    || rowErrors.includes('Mata Anggaran tidak sesuai master')
                    || rowErrors.includes('Master Mata Anggaran belum tersedia');
                  const kodeActivityInvalid = !row.kodeActivity.trim()
                    || rowErrors.includes('Kode Activity tidak sesuai Mata Anggaran')
                    || rowErrors.includes('Master Mata Anggaran belum tersedia');
                  const activityOptions = mataAnggaranMaster
                    .filter(item => normalizeMasterValue(item.mataAnggaran) === normalizeMasterValue(row.mataAnggaran))
                    .map(item => ({ value: item.kodeActivity, label: item.kodeActivity }));
                  const selectedMataAnggaran = row.mataAnggaran
                    ? mataAnggaranOptions.find(option => normalizeMasterValue(option.value) === normalizeMasterValue(row.mataAnggaran))
                      || { value: row.mataAnggaran, label: row.mataAnggaran }
                    : null;
                  const selectedActivity = row.kodeActivity
                    ? activityOptions.find(option => normalizeMasterValue(option.value) === normalizeMasterValue(row.kodeActivity))
                      || { value: row.kodeActivity, label: row.kodeActivity }
                    : null;
                  const cellClass = mode === 'direct' ? 'border-r border-gray-200 p-0' : 'border-r border-gray-100 p-1.5';
                  const inputClass = mode === 'direct'
                    ? 'h-7 w-full border-0 bg-transparent px-2 py-0 leading-7 outline-none focus:bg-emerald-50'
                    : 'h-9 w-full rounded-md border border-gray-200 px-2 outline-none focus:border-[#009B4F]';

                  return (
                  <tr key={row.id} className={`${mode === 'direct' ? 'h-7' : ''} ${!isEmpty && rowErrors.length ? 'bg-red-50/40' : index % 2 ? 'bg-gray-50/50' : 'bg-white'}`}>
                    <td className={`border-r border-gray-200 px-3 text-center font-mono text-gray-400 ${mode === 'direct' ? 'py-0 leading-7' : 'py-2'}`}>{index + 1}</td>
                    <td className={cellClass}><input type="date" value={row.tanggal} onChange={event => updateRow(row.id, 'tanggal', event.target.value)} onPaste={event => handleDirectPaste(event, index, 'tanggal')} className={`${inputClass} min-w-32`} /></td>
                    <td className={cellClass}><input value={row.kodeOutlet} onChange={event => updateRow(row.id, 'kodeOutlet', event.target.value)} onPaste={event => handleDirectPaste(event, index, 'kodeOutlet')} className={`${inputClass} min-w-32 font-mono`} /></td>
                    <td className={cellClass}><input value={row.namaOutlet} onChange={event => updateRow(row.id, 'namaOutlet', event.target.value)} onPaste={event => handleDirectPaste(event, index, 'namaOutlet')} className={`${inputClass} min-w-48 font-semibold`} /></td>
                    <td className={cellClass}><input value={row.kebutuhanAnggaran} onChange={event => updateRow(row.id, 'kebutuhanAnggaran', event.target.value)} onPaste={event => handleDirectPaste(event, index, 'kebutuhanAnggaran')} className={`${inputClass} min-w-64`} /></td>
                    <td className={`${cellClass} min-w-64`} onPaste={event => handleDirectPaste(event, index, 'mataAnggaran')}>
                      <Select<SelectOption, false>
                        value={selectedMataAnggaran}
                        onChange={option => updateMataAnggaran(row.id, option?.value || '')}
                        options={mataAnggaranOptions}
                        styles={mode === 'direct' ? directSelectStyles : reviewSelectStyles(mataAnggaranInvalid)}
                        placeholder="Pilih Mata Anggaran..."
                        isClearable
                        menuPosition="fixed"
                        noOptionsMessage={() => 'Data tidak ditemukan'}
                        aria-label={`Mata Anggaran baris ${index + 1}`}
                      />
                    </td>
                    <td className={`${cellClass} min-w-56`} onPaste={event => handleDirectPaste(event, index, 'kodeActivity')}>
                      <Select<SelectOption, false>
                        value={selectedActivity}
                        onChange={option => updateRow(row.id, 'kodeActivity', option?.value || '')}
                        options={activityOptions}
                        styles={mode === 'direct' ? directSelectStyles : reviewSelectStyles(kodeActivityInvalid)}
                        placeholder={row.mataAnggaran ? 'Pilih Activity...' : 'Pilih Mata Anggaran dulu'}
                        isDisabled={!row.mataAnggaran}
                        isClearable
                        menuPosition="fixed"
                        noOptionsMessage={() => 'Activity tidak ditemukan'}
                        aria-label={`Kode Activity baris ${index + 1}`}
                      />
                    </td>
                    <td className={cellClass}><input type="number" min="0" value={Number.isFinite(row.nominalPersetujuan) ? row.nominalPersetujuan : ''} onChange={event => updateRow(row.id, 'nominalPersetujuan', event.target.value)} onPaste={event => handleDirectPaste(event, index, 'nominalPersetujuan')} className={`${inputClass} min-w-40 text-right font-mono font-bold text-blue-600`} /></td>
                    <td className={`border-r border-gray-200 text-center ${mode === 'direct' ? 'p-0' : 'px-3 py-2'}`}>
                      <input
                        type="checkbox"
                        checked={row.verified}
                        onChange={() => toggleVerification(row.id)}
                        className="h-4 w-4 cursor-pointer accent-[#009B4F]"
                        aria-label={`Verifikasi baris ${index + 1}`}
                      />
                    </td>
                    {mode !== 'direct' && (
                      <td className="border-r border-gray-100 px-3 py-2 text-center">
                        {isEmpty ? (
                          <span className="text-[10px] font-semibold text-gray-400">Belum diisi</span>
                        ) : rowErrors.length ? (
                          <div className="group relative inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-600" title={rowErrors.join('; ')}>
                            <AlertCircle className="h-3.5 w-3.5" />
                            Perlu Perbaikan
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Valid
                          </span>
                        )}
                      </td>
                    )}
                    <td className={`text-center ${mode === 'direct' ? 'p-0' : 'px-3 py-2'}`}>
                      <button type="button" onClick={() => deleteRow(row.id)} className={`rounded-md text-red-600 hover:bg-red-50 ${mode === 'direct' ? 'p-1' : 'p-2'}`} title="Hapus baris">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col justify-between gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row sm:items-center">
            {mode === 'direct' ? (
              <button type="button" onClick={addDirectRow} disabled={isSaving} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <Plus className="h-4 w-4" />
                Tambah Baris
              </button>
            ) : (
              <button type="button" onClick={() => setStep(1)} disabled={isSaving} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <ArrowLeft className="h-4 w-4" />
                Kembali
              </button>
            )}
            <div className="flex flex-col items-end gap-2">
              {!canSave && <p className="text-xs font-semibold text-amber-600">Hak akses edit database Anggaran diperlukan untuk menyimpan.</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={createNodin}
                  disabled={!rowsToSave.length || invalidCount > 0 || isSaving || isCreatingNodin}
                  className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white shadow-md shadow-blue-700/20 hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
                >
                  {isCreatingNodin ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {isCreatingNodin ? 'Membuat Nodin...' : 'Buat Nodin'}
                </button>
                <button
                  type="button"
                  onClick={saveData}
                  disabled={isSaving || isCreatingNodin || !rowsToSave.length || invalidCount > 0 || !canSave}
                  className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-6 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none ${hasCurrentNodin ? 'bg-[#009B4F] shadow-md shadow-emerald-600/20 hover:bg-[#008543]' : 'bg-gray-400 hover:bg-gray-500'}`}
                  title={hasCurrentNodin ? 'Simpan data ke Google Sheet' : 'Buat Nodin terlebih dahulu'}
                >
                  {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {isSaving ? 'Menyimpan...' : 'Simpan Data'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
