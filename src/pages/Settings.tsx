import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, Edit2, Globe, Link as LinkIcon, Loader2, Database, RefreshCw, ChevronUp, ChevronDown, X, Table2, Columns3, Mail, RotateCcw, MessageCircle, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { ConfirmModal } from '../components/ConfirmModal';
import { blastTemplateService, defaultBlastEmailTemplate, defaultBlastWhatsAppTemplate } from '../services/blastTemplateService';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { AnimatedModal } from '../components/AnimatedModal';
import { uploadExcelConfigService, type UploadExcelConfigMap } from '../services/uploadExcelConfigService';

interface AppLink {
  id: string;
  label: string;
  url: string;
  logo?: string;
  order: number;
}

interface SettingsProps {
  type: 'supporting-apps' | 'general' | 'upload-excel' | 'template-blast' | 'template-blast-whatsapp';
}

interface DataEditorConfig {
  collectionName: 'cabang' | 'norek_mapping' | 'gl_bank';
  title: string;
  description: string;
  defaultColumns: string[];
}

interface DataEditorRow {
  id: string;
  isNew?: boolean;
  [key: string]: any;
}

type EditorConfirmAction = 'saveAll' | 'deleteRow' | null;

export function Settings({ type }: SettingsProps) {
  const [apps, setApps] = useState<AppLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentApp, setCurrentApp] = useState<AppLink | null>(null);
  const [newApp, setNewApp] = useState({ label: '', url: '', logo: '' });
  const [isDeleting, setIsDeleting] = useState(false);
  const [appToDelete, setAppToDelete] = useState<string | null>(null);
  const [dataEditorConfig, setDataEditorConfig] = useState<DataEditorConfig | null>(null);
  const [dataEditorRows, setDataEditorRows] = useState<DataEditorRow[]>([]);
  const [dataEditorColumns, setDataEditorColumns] = useState<string[]>([]);
  const [newEditorField, setNewEditorField] = useState('');
  const [isDataEditorLoading, setIsDataEditorLoading] = useState(false);
  const [savingEditorRowId, setSavingEditorRowId] = useState<string | null>(null);
  const [isEditorConfirmOpen, setIsEditorConfirmOpen] = useState(false);
  const [editorConfirmAction, setEditorConfirmAction] = useState<EditorConfirmAction>(null);
  const [editorRowToDelete, setEditorRowToDelete] = useState<DataEditorRow | null>(null);
  const [isSavingAllEditorRows, setIsSavingAllEditorRows] = useState(false);
  const [blastTemplate, setBlastTemplate] = useState(defaultBlastEmailTemplate);
  const [blastWhatsAppTemplate, setBlastWhatsAppTemplate] = useState(defaultBlastWhatsAppTemplate);
  const [isBlastTemplateLoading, setIsBlastTemplateLoading] = useState(false);
  const [isBlastTemplateSaving, setIsBlastTemplateSaving] = useState(false);
  const [uploadExcelConfigs, setUploadExcelConfigs] = useState<UploadExcelConfigMap>({});
  const [isUploadConfigLoading, setIsUploadConfigLoading] = useState(false);
  const [isUploadConfigSaving, setIsUploadConfigSaving] = useState(false);

  useEffect(() => {
    if (type !== 'supporting-apps') {
      setIsLoading(false);
      return;
    }

    const path = 'supporting_apps';
    const unsub = onSnapshot(collection(db, path), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AppLink[];
      // Sort by order
      setApps(data.sort((a, b) => (a.order || 0) - (b.order || 0)));
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      setIsLoading(false);
    });

    return () => unsub();
  }, [type]);

  useEffect(() => {
    if (type !== 'template-blast' && type !== 'template-blast-whatsapp') return;

    setIsBlastTemplateLoading(true);
    const loadTemplate = type === 'template-blast'
      ? blastTemplateService.getTemplate().then(setBlastTemplate)
      : blastTemplateService.getWhatsAppTemplate().then(setBlastWhatsAppTemplate);

    loadTemplate
      .catch(error => {
        console.error('Blast template load error:', error);
        toast.error('Gagal memuat template blast');
      })
      .finally(() => setIsBlastTemplateLoading(false));
  }, [type]);

  useEffect(() => {
    if (type !== 'upload-excel') return;

    setIsUploadConfigLoading(true);
    uploadExcelConfigService.getConfigs()
      .then(setUploadExcelConfigs)
      .catch(error => {
        console.error('Upload excel config load error:', error);
        toast.error('Gagal memuat konfigurasi upload excel');
      })
      .finally(() => setIsUploadConfigLoading(false));
  }, [type]);

  const updateUploadConfig = (id: string, field: 'firstDataRow' | string, value: string) => {
    const numericValue = Number(value);
    setUploadExcelConfigs(prev => {
      const item = prev[id];
      if (!item) return prev;
      if (field === 'firstDataRow') {
        return { ...prev, [id]: { ...item, firstDataRow: Number.isFinite(numericValue) ? numericValue : 0 } };
      }
      return {
        ...prev,
        [id]: {
          ...item,
          columns: {
            ...item.columns,
            [field]: Number.isFinite(numericValue) ? numericValue : 0,
          },
        },
      };
    });
  };

  const saveUploadExcelConfigs = async () => {
    setIsUploadConfigSaving(true);
    try {
      await uploadExcelConfigService.saveConfigs(uploadExcelConfigs);
      toast.success('Konfigurasi upload excel berhasil disimpan');
    } catch (error) {
      console.error('Upload excel config save error:', error);
      toast.error('Gagal menyimpan konfigurasi upload excel');
    } finally {
      setIsUploadConfigSaving(false);
    }
  };

  const renderBlastTemplatePreview = () => {
    const detailRows = `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 10px;">1</td>
        <td style="padding: 10px; font-weight: 700;">BRI</td>
        <td style="padding: 10px; text-align: right; font-weight: 700; color: #1d4ed8;">Rp 12.500.000</td>
        <td style="padding: 10px;">Contoh transaksi Hutang Operasional Lain<div style="margin-top: 4px; color: #dc2626; font-size: 12px;">Status: Belum</div></td>
      </tr>
    `;

    return blastTemplate
      .replaceAll('{{cabang}}', 'CP AMBON')
      .replaceAll('{{tanggal}}', '2026-05-19')
      .replaceAll('{{jumlahTransaksi}}', '1')
      .replaceAll('{{totalNominal}}', 'Rp 12.500.000')
      .replaceAll('{{detailRows}}', detailRows);
  };

  const renderBlastWhatsAppPreview = () => {
    const detailRows = [
      '1. AKUN (Db): BSI\n   Nominal: Rp 2.751.560\n   Keterangan: BELUM DIBUKUKAN CABANG\n   Status: Belum',
      '2. AKUN (Db): BSI\n   Nominal: Rp 296.878\n   Keterangan: BELUM DIBUKUKAN CABANG\n   Status: Belum',
      '3. AKUN (Db): BSI\n   Nominal: Rp 300.782\n   Keterangan: BELUM DIBUKUKAN CABANG\n   Status: Belum',
    ].join('\n\n');

    const rendered = blastWhatsAppTemplate
      .replaceAll('{{1}}', 'CPS CENTRAL')
      .replaceAll('{{2}}', '2026-03-31')
      .replaceAll('{{3}}', '3')
      .replaceAll('{{4}}', 'Rp 3.349.220')
      .replaceAll('{{5}}', detailRows)
      .replaceAll('{{cabang}}', 'CPS CENTRAL')
      .replaceAll('{{tanggal}}', '2026-03-31')
      .replaceAll('{{jumlahTransaksi}}', '3')
      .replaceAll('{{totalNominal}}', 'Rp 3.349.220')
      .replaceAll('{{detailRows}}', detailRows);

    if (blastWhatsAppTemplate.includes('{{5}}') || blastWhatsAppTemplate.includes('{{detailRows}}')) {
      return rendered;
    }

    return `${rendered}\n\nRincian transaksi:\n${detailRows}`;
  };

  const saveBlastTemplate = async () => {
    if (!blastTemplate.trim()) {
      toast.error('Template tidak boleh kosong');
      return;
    }

    setIsBlastTemplateSaving(true);
    try {
      await blastTemplateService.saveTemplate(blastTemplate);
      toast.success('Template blast berhasil disimpan');
    } catch (error) {
      console.error('Blast template save error:', error);
      toast.error('Gagal menyimpan template blast');
    } finally {
      setIsBlastTemplateSaving(false);
    }
  };

  const saveBlastWhatsAppTemplate = async () => {
    if (!blastWhatsAppTemplate.trim()) {
      toast.error('Template WhatsApp tidak boleh kosong');
      return;
    }

    setIsBlastTemplateSaving(true);
    try {
      await blastTemplateService.saveWhatsAppTemplate(blastWhatsAppTemplate);
      toast.success('Template blast WhatsApp berhasil disimpan');
    } catch (error) {
      console.error('Blast WhatsApp template save error:', error);
      toast.error('Gagal menyimpan template blast WhatsApp');
    } finally {
      setIsBlastTemplateSaving(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500 * 1024) { // 500KB limit
        toast.error('Ukuran logo maksimal 500KB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        if (isEdit && currentApp) {
          setCurrentApp({ ...currentApp, logo: base64String });
        } else {
          setNewApp({ ...newApp, logo: base64String });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAdd = async () => {
    if (!auth.currentUser) {
      toast.error('Anda harus masuk dengan Google untuk menambah aplikasi');
      return;
    }

    if (!newApp.label || !newApp.url) {
      toast.error('Label dan URL harus diisi');
      return;
    }
    
    const path = 'supporting_apps';
    try {
      await addDoc(collection(db, path), {
        label: newApp.label,
        url: newApp.url,
        logo: newApp.logo,
        order: apps.length
      });
      setNewApp({ label: '', url: '', logo: '' });
      setIsAdding(false);
      toast.success('Aplikasi berhasil ditambahkan');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const handleUpdate = async () => {
    if (!currentApp) return;
    
    const path = `supporting_apps/${currentApp.id}`;
    try {
      await updateDoc(doc(db, 'supporting_apps', currentApp.id), {
        label: currentApp.label,
        url: currentApp.url,
        logo: currentApp.logo || ''
      });
      setIsEditing(false);
      setCurrentApp(null);
      toast.success('Aplikasi berhasil diperbarui');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleDelete = (id: string) => {
    setAppToDelete(id);
    setIsDeleting(true);
  };

  const confirmDelete = async () => {
    if (!appToDelete) return;
    
    if (!auth.currentUser) {
      toast.error('Anda harus masuk dengan Google untuk menghapus aplikasi');
      setIsDeleting(false);
      setAppToDelete(null);
      return;
    }
    
    const path = `supporting_apps/${appToDelete}`;
    try {
      await deleteDoc(doc(db, 'supporting_apps', appToDelete));
      toast.success('Aplikasi berhasil dihapus');
      setIsDeleting(false);
      setAppToDelete(null);
    } catch (error) {
      console.error('Delete error:', error);
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const closeSupportingAppModal = () => {
    setIsAdding(false);
    setIsEditing(false);
    setCurrentApp(null);
  };

  const collectColumns = (rows: DataEditorRow[], defaultColumns: string[]) => {
    const dynamicColumns = rows.flatMap(row => Object.keys(row).filter(key => key !== 'id' && key !== 'isNew'));
    return Array.from(new Set([...defaultColumns, ...dynamicColumns]));
  };

  const openDataEditor = async (config: DataEditorConfig) => {
    setDataEditorConfig(config);
    setIsDataEditorLoading(true);
    setDataEditorRows([]);
    setDataEditorColumns(config.defaultColumns);
    setNewEditorField('');

    try {
      const snapshot = await getDocs(collection(db, config.collectionName));
      const rows = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as DataEditorRow))
        .sort((a, b) => String(a.nama || a.namaCabang || a.keterangan || a.id).localeCompare(String(b.nama || b.namaCabang || b.keterangan || b.id)));

      setDataEditorRows(rows);
      setDataEditorColumns(collectColumns(rows, config.defaultColumns));
    } catch (error) {
      console.error('Data editor load error:', error);
      handleFirestoreError(error, OperationType.LIST, config.collectionName);
    } finally {
      setIsDataEditorLoading(false);
    }
  };

  const closeDataEditor = () => {
    setDataEditorConfig(null);
    setDataEditorRows([]);
    setDataEditorColumns([]);
    setNewEditorField('');
    setSavingEditorRowId(null);
    setIsEditorConfirmOpen(false);
    setEditorConfirmAction(null);
    setEditorRowToDelete(null);
  };

  useEscapeToClose(isAdding || isEditing, closeSupportingAppModal);
  useEscapeToClose(isDeleting, () => {
    setIsDeleting(false);
    setAppToDelete(null);
  });
  useEscapeToClose(!!dataEditorConfig && !isEditorConfirmOpen, closeDataEditor);

  const buildEditorPayload = (row: DataEditorRow) => {
    return dataEditorColumns.reduce<Record<string, any>>((payload, column) => {
      payload[column] = row[column] ?? '';
      return payload;
    }, {});
  };

  const saveEditorRow = async (row: DataEditorRow, silent = false) => {
    if (!dataEditorConfig) return;
    const currentRow = dataEditorRows.find(item => item.id === row.id) || row;
    if (!currentRow.id.trim()) {
      toast.error('ID dokumen tidak boleh kosong');
      return;
    }

    setSavingEditorRowId(currentRow.id);
    try {
      await setDoc(doc(db, dataEditorConfig.collectionName, currentRow.id), buildEditorPayload(currentRow), { merge: true });
      setDataEditorRows(prev => prev.map(item => item.id === currentRow.id ? { ...item, isNew: false } : item));
      if (!silent) toast.success('Data berhasil diperbarui');
    } catch (error) {
      console.error('Data editor save error:', error);
      handleFirestoreError(error, OperationType.UPDATE, `${dataEditorConfig.collectionName}/${currentRow.id}`);
    } finally {
      setSavingEditorRowId(null);
    }
  };

  const updateEditorCell = (rowId: string, field: string, value: string) => {
    setDataEditorRows(prev => prev.map(row => row.id === rowId ? { ...row, [field]: value } : row));
  };

  const createBlankEditorRow = (index = 0) => {
    const id = `${dataEditorConfig?.collectionName || 'row'}_${Date.now()}_${index}`;
    return dataEditorColumns.reduce<DataEditorRow>((row, column) => {
      row[column] = '';
      return row;
    }, { id, isNew: true });
  };

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    const pastedText = event.clipboardData.getData('text');
    if (!pastedText.includes('\t') && !pastedText.includes('\n')) return;

    event.preventDefault();
    const rows = pastedText.replace(/\r/g, '').split('\n').filter(row => row.trim() !== '').map(row => row.split('\t'));

    setDataEditorRows(prev => {
      const next = [...prev];
      while (next.length < rowIndex + rows.length) {
        next.push(createBlankEditorRow(next.length));
      }

      rows.forEach((cells, rowOffset) => {
        const targetIndex = rowIndex + rowOffset;
        cells.forEach((cell, cellOffset) => {
          const column = dataEditorColumns[columnIndex + cellOffset];
          if (!column) return;
          next[targetIndex] = {
            ...next[targetIndex],
            [column]: cell.trim(),
          };
        });
      });

      return next;
    });
  };

  const addEditorColumn = () => {
    if (!dataEditorConfig) return;
    const field = newEditorField.trim();
    if (!field) {
      toast.error('Nama kolom belum diisi');
      return;
    }
    if (dataEditorColumns.includes(field)) {
      toast.error('Kolom sudah tersedia');
      return;
    }

    setDataEditorColumns(prev => [...prev, field]);
    setDataEditorRows(prev => prev.map(row => ({ ...row, [field]: '' })));
    setNewEditorField('');
    toast.success(`Kolom ${field} ditambahkan. Klik Simpan Semua untuk menyimpan ke Firebase.`);
  };

  const addEditorRow = () => {
    if (!dataEditorConfig) return;
    setDataEditorRows(prev => [createBlankEditorRow(prev.length), ...prev]);
  };

  const handleEditorDeleteClick = (row: DataEditorRow) => {
    setEditorRowToDelete(row);
    setEditorConfirmAction('deleteRow');
    setIsEditorConfirmOpen(true);
  };

  const deleteEditorRow = async (row: DataEditorRow) => {
    if (!dataEditorConfig) return;
    if (row.isNew) {
      setDataEditorRows(prev => prev.filter(item => item.id !== row.id));
      return;
    }

    try {
      await deleteDoc(doc(db, dataEditorConfig.collectionName, row.id));
      setDataEditorRows(prev => prev.filter(item => item.id !== row.id));
      toast.success('Data berhasil dihapus');
    } catch (error) {
      console.error('Data editor delete error:', error);
      handleFirestoreError(error, OperationType.DELETE, `${dataEditorConfig.collectionName}/${row.id}`);
    }
  };

  const handleSaveAllEditorRows = async () => {
    if (!dataEditorConfig) return;

    const rowsWithEmptyId = dataEditorRows.filter(row => !row.id.trim());
    if (rowsWithEmptyId.length > 0) {
      toast.error('Ada baris dengan Doc ID kosong');
      return;
    }

    setIsSavingAllEditorRows(true);
    try {
      await Promise.all(dataEditorRows.map(row => (
        setDoc(doc(db, dataEditorConfig.collectionName, row.id), buildEditorPayload(row), { merge: true })
      )));
      setDataEditorRows(prev => prev.map(row => ({ ...row, isNew: false })));
      toast.success(`${dataEditorRows.length} data berhasil disimpan ke Firebase`);
    } catch (error) {
      console.error('Save all data editor error:', error);
      handleFirestoreError(error, OperationType.UPDATE, dataEditorConfig.collectionName);
    } finally {
      setIsSavingAllEditorRows(false);
    }
  };

  const confirmEditorAction = async () => {
    if (editorConfirmAction === 'saveAll') {
      await handleSaveAllEditorRows();
    }
    if (editorConfirmAction === 'deleteRow' && editorRowToDelete) {
      await deleteEditorRow(editorRowToDelete);
    }

    setIsEditorConfirmOpen(false);
    setEditorConfirmAction(null);
    setEditorRowToDelete(null);
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= apps.length) return;

    const updatedApps = [...apps];
    const temp = updatedApps[index];
    updatedApps[index] = updatedApps[newIndex];
    updatedApps[newIndex] = temp;

    // Update orders in Firestore
    const loadingToast = toast.loading('Memperbarui urutan...');
    try {
      await Promise.all([
        updateDoc(doc(db, 'supporting_apps', updatedApps[index].id), { order: index }),
        updateDoc(doc(db, 'supporting_apps', updatedApps[newIndex].id), { order: newIndex })
      ]);
      toast.success('Urutan berhasil diperbarui', { id: loadingToast });
    } catch (error) {
      console.error('Order update error:', error);
      toast.error('Gagal memperbarui urutan', { id: loadingToast });
    }
  };

  if (type === 'template-blast-whatsapp') {
    return (
      <div className="flex h-full min-h-0 flex-col space-y-6">
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-emerald-50 p-2 text-[#009B4F]">
                <MessageCircle className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Template Blast WhatsApp</h2>
                <p className="mt-1 max-w-3xl text-sm text-gray-500">
                  Kelola isi pesan untuk tombol Send WhatsApp pada Hutang Operasional Lain.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setBlastWhatsAppTemplate(defaultBlastWhatsAppTemplate)}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" />
                Reset Default
              </button>
              <button
                onClick={saveBlastWhatsAppTemplate}
                disabled={isBlastTemplateSaving || isBlastTemplateLoading}
                className="flex items-center gap-2 rounded-lg bg-[#009B4F] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#008543] disabled:opacity-50"
              >
                {isBlastTemplateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan Template
              </button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-sm font-black text-gray-800">Template Pesan WhatsApp</h3>
              <p className="mt-1 text-xs text-gray-500">
                Placeholder: {'{{1}}'} cabang, {'{{2}}'} tanggal, {'{{3}}'} jumlah transaksi, {'{{4}}'} total nominal, {'{{5}}'} rincian transaksi.
              </p>
            </div>
            {isBlastTemplateLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#009B4F]" />
              </div>
            ) : (
              <textarea
                value={blastWhatsAppTemplate}
                onChange={(event) => setBlastWhatsAppTemplate(event.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none border-0 bg-gray-950 p-5 font-mono text-[12px] leading-relaxed text-emerald-100 outline-none"
              />
            )}
          </div>

          <div className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-sm font-black text-gray-800">Preview Pesan</h3>
              <p className="mt-1 text-xs text-gray-500">Preview menggunakan contoh data sebelum template dipakai di link wa.me.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4">
              <pre className="whitespace-pre-wrap rounded-xl border border-gray-100 bg-white p-4 font-mono text-sm leading-relaxed text-gray-800">{renderBlastWhatsAppPreview()}</pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'template-blast') {
    return (
      <div className="flex h-full min-h-0 flex-col space-y-6">
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-emerald-50 p-2 text-[#009B4F]">
                <Mail className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Template Blast Email</h2>
                <p className="mt-1 max-w-3xl text-sm text-gray-500">
                  Kelola template HTML untuk Preview Body Email pada Blast Email Hutang Operasional Lain.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setBlastTemplate(defaultBlastEmailTemplate)}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" />
                Reset Default
              </button>
              <button
                onClick={saveBlastTemplate}
                disabled={isBlastTemplateSaving || isBlastTemplateLoading}
                className="flex items-center gap-2 rounded-lg bg-[#009B4F] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#008543] disabled:opacity-50"
              >
                {isBlastTemplateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan Template
              </button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-sm font-black text-gray-800">Kode HTML Email</h3>
              <p className="mt-1 text-xs text-gray-500">
                Placeholder tersedia: {'{{cabang}}'}, {'{{tanggal}}'}, {'{{jumlahTransaksi}}'}, {'{{totalNominal}}'}, {'{{detailRows}}'}.
              </p>
            </div>
            {isBlastTemplateLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#009B4F]" />
              </div>
            ) : (
              <textarea
                value={blastTemplate}
                onChange={(event) => setBlastTemplate(event.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none border-0 bg-gray-950 p-5 font-mono text-[11px] leading-relaxed text-emerald-100 outline-none"
              />
            )}
          </div>

          <div className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-sm font-black text-gray-800">Preview Body Email</h3>
              <p className="mt-1 text-xs text-gray-500">Preview menggunakan contoh data agar layout email bisa dicek sebelum disimpan.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4">
              <div dangerouslySetInnerHTML={{ __html: renderBlastTemplatePreview() }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'upload-excel') {
    const configs = Object.values(uploadExcelConfigs);
    const groups = Array.from(new Set(configs.map(item => item.group)));

    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-50 p-2 text-[#009B4F]">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Set Upload Excel</h2>
                <p className="text-sm text-gray-500">Atur baris awal dan index kolom pembacaan file upload Proses Moker dan Proses Rekon.</p>
              </div>
            </div>
            <button
              onClick={saveUploadExcelConfigs}
              disabled={isUploadConfigSaving || isUploadConfigLoading}
              className="flex w-fit items-center gap-2 rounded-lg bg-[#009B4F] px-4 py-2 text-xs font-bold text-white shadow-md shadow-[#009B4F]/10 transition-colors hover:bg-[#008543] disabled:opacity-50"
            >
              {isUploadConfigSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Simpan
            </button>
          </div>

          {isUploadConfigLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#009B4F]" />
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map(group => (
                <div key={group} className="overflow-hidden rounded-xl border border-gray-100">
                  <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
                    <h3 className="text-sm font-black text-gray-800">{group}</h3>
                    <p className="mt-1 text-xs text-gray-500">Index menggunakan basis 0. Contoh kolom A = 0, B = 1, C = 2.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse bg-white text-xs">
                      <thead>
                        <tr className="bg-[#005245]">
                          <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Jenis Upload</th>
                          <th className="border border-[#004237] px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white">Baris Pertama</th>
                          <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Index Kolom</th>
                        </tr>
                      </thead>
                      <tbody>
                        {configs.filter(item => item.group === group).map(item => (
                          <tr key={item.id} className="odd:bg-white even:bg-gray-50/70">
                            <td className="border border-gray-200 px-3 py-2 font-bold text-gray-800">{item.label}</td>
                            <td className="border border-gray-200 p-1">
                              <input
                                type="number"
                                value={item.firstDataRow}
                                onChange={(event) => updateUploadConfig(item.id, 'firstDataRow', event.target.value)}
                                className="h-8 w-full rounded border border-gray-200 px-2 text-center text-xs outline-none focus:border-[#009B4F]"
                              />
                            </td>
                            <td className="border border-gray-200 px-3 py-2">
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                {Object.entries(item.columns).map(([column, value]) => (
                                  <label key={`${item.id}-${column}`} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-2 py-1">
                                    <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-wider text-gray-500">{column}</span>
                                    <input
                                      type="number"
                                      value={value}
                                      onChange={(event) => updateUploadConfig(item.id, column, event.target.value)}
                                      className="h-7 w-16 rounded border border-gray-200 px-2 text-center text-xs outline-none focus:border-[#009B4F]"
                                    />
                                  </label>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (type === 'general') {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-emerald-50 rounded-lg text-[#009B4F]">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Manajemen Data</h2>
              <p className="text-sm text-gray-500">Kelola data master aplikasi.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 border border-gray-100 rounded-xl bg-gray-50/50">
              <h3 className="font-semibold text-gray-800 mb-2">Data Cabang & Area</h3>
              <p className="text-sm text-gray-500 mb-4">
                Edit data master cabang, area, kode, dan field tambahan seperti email cabang langsung dari Firebase.
              </p>
              <button
                onClick={() => openDataEditor({
                  collectionName: 'cabang',
                  title: 'Edit Data Cabang',
                  description: 'Data Firebase collection cabang',
                  defaultColumns: ['nama', 'area', 'passionCode', 'sapCode', 'email', 'whatsapp'],
                })}
                className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Table2 className="w-4 h-4" />
                Edit Data Cabang
              </button>
            </div>

            <div className="p-4 border border-gray-100 rounded-xl bg-gray-50/50">
              <h3 className="font-semibold text-gray-800 mb-2">Data Nomor Rekening</h3>
              <p className="text-sm text-gray-500 mb-4">
                Edit mapping nomor rekening, nama cabang, dan field tambahan seperti jenis rekening langsung dari Firebase.
              </p>
              <button
                onClick={() => openDataEditor({
                  collectionName: 'norek_mapping',
                  title: 'Edit Data No Rekening',
                  description: 'Data Firebase collection norek_mapping',
                  defaultColumns: ['keterangan', 'namaCabang', 'jenisRekening'],
                })}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Table2 className="w-4 h-4" />
                Edit Data No Rekening
              </button>
            </div>

            <div className="p-4 border border-gray-100 rounded-xl bg-gray-50/50">
              <h3 className="font-semibold text-gray-800 mb-2">Data GL Bank</h3>
              <p className="text-sm text-gray-500 mb-4">
                Edit mapping Bank, No Rekening, Nomor GL, dan PIC untuk pengisian otomatis Saldo Harian.
              </p>
              <button
                onClick={() => openDataEditor({
                  collectionName: 'gl_bank',
                  title: 'Edit Data GL Bank',
                  description: 'Data Firebase collection gl_bank',
                  defaultColumns: ['bank', 'noRekening', 'nomorGL', 'pic'],
                })}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Table2 className="w-4 h-4" />
                Edit Data GL Bank
              </button>
            </div>
          </div>
        </div>

        <AnimatedModal isOpen={!!dataEditorConfig} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          {dataEditorConfig ? (
            <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex flex-col justify-between gap-4 border-b border-gray-100 p-5 lg:flex-row lg:items-center">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">{dataEditorConfig.title}</h3>
                  <p className="text-xs text-gray-500">{dataEditorConfig.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={newEditorField}
                      onChange={(event) => setNewEditorField(event.target.value)}
                      className="h-9 w-44 rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
                      placeholder="Nama kolom baru"
                    />
                    <button
                      onClick={addEditorColumn}
                      className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-gray-900"
                    >
                      <Columns3 className="h-4 w-4" />
                      Tambah Kolom
                    </button>
                  </div>
                  <button
                    onClick={addEditorRow}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4" />
                    Tambah Baris
                  </button>
                  <button
                    onClick={() => {
                      setEditorConfirmAction('saveAll');
                      setIsEditorConfirmOpen(true);
                    }}
                    disabled={isSavingAllEditorRows}
                    className="flex items-center gap-2 rounded-lg bg-[#009B4F] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#008543] disabled:opacity-50"
                  >
                    {isSavingAllEditorRows ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Simpan Semua
                  </button>
                  <button
                    onClick={closeDataEditor}
                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-gray-50/40 p-4">
                {isDataEditorLoading ? (
                  <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-[#009B4F]" />
                  </div>
                ) : (
                  <table className="w-full min-w-[1000px] border-collapse bg-white text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#005245]">
                        <th className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Doc ID</th>
                        {dataEditorColumns.map(column => (
                          <th key={column} className="border border-[#004237] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">
                            {column}
                          </th>
                        ))}
                        <th className="w-24 border border-[#004237] px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataEditorRows.map((row, rowIndex) => (
                        <tr key={row.id} className="odd:bg-white even:bg-gray-50/70">
                          <td className="border border-gray-200 px-3 py-1 font-mono text-[11px] text-gray-500">{row.id}</td>
                          {dataEditorColumns.map((column, columnIndex) => (
                            <td key={`${row.id}-${column}`} className="border border-gray-200 p-0">
                              <input
                                value={row[column] ?? ''}
                                onChange={(event) => updateEditorCell(row.id, column, event.target.value)}
                                onPaste={(event) => handleEditorPaste(event, rowIndex, columnIndex)}
                                className="h-8 w-full border-0 px-2 text-[11px] outline-none focus:bg-emerald-50"
                              />
                            </td>
                          ))}
                          <td className="border border-gray-200 px-2 py-1">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => saveEditorRow(row)}
                                disabled={savingEditorRowId === row.id}
                                className="rounded-lg bg-emerald-50 p-1.5 text-[#009B4F] transition-colors hover:bg-emerald-100 disabled:opacity-50"
                                title="Simpan"
                              >
                                {savingEditorRowId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                onClick={() => handleEditorDeleteClick(row)}
                                className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                                title="Hapus"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : <div />}
        </AnimatedModal>

        <ConfirmModal
          isOpen={isEditorConfirmOpen}
          title={editorConfirmAction === 'saveAll' ? 'Konfirmasi Simpan Semua' : 'Konfirmasi Hapus Data'}
          message={editorConfirmAction === 'saveAll'
            ? `Apakah Anda yakin ingin menyimpan ${dataEditorRows.length} data ke Firebase?`
            : 'Apakah Anda yakin ingin menghapus data ini dari Firebase? Tindakan ini tidak dapat dibatalkan.'
          }
          onConfirm={confirmEditorAction}
          onCancel={() => {
            setIsEditorConfirmOpen(false);
            setEditorConfirmAction(null);
            setEditorRowToDelete(null);
          }}
          confirmText="Ya"
          cancelText="Tidak"
          loadingText="Menyimpan..."
          variant={editorConfirmAction === 'saveAll' ? 'primary' : 'danger'}
          isLoading={isSavingAllEditorRows}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Pengaturan Supporting Apps</h2>
            <p className="text-sm text-gray-500">Kelola aplikasi eksternal yang akan di-embed ke dalam FIFA.</p>
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tambah Aplikasi
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-16 text-center">Urutan</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nama Aplikasi</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">URL / Link</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {apps.map((app, index) => (
                <tr key={app.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <button 
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-[#009B4F] disabled:opacity-20 cursor-pointer"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === apps.length - 1}
                        className="p-1 text-gray-400 hover:text-[#009B4F] disabled:opacity-20 cursor-pointer"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-[#009B4F]">
                        <Globe className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-gray-700">{app.label}</span>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <LinkIcon className="w-3 h-3" />
                      <span className="truncate max-w-xs">{app.url}</span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => {
                          setCurrentApp(app);
                          setIsEditing(true);
                        }}
                        className="p-2 text-gray-400 hover:text-blue-500 transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(app.id)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatedModal isOpen={isAdding || isEditing} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800">
                {isEditing ? 'Edit Supporting App' : 'Tambah Supporting App'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-col items-center mb-4">
                <div className="w-20 h-20 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden mb-2">
                  {(isEditing ? currentApp?.logo : newApp.logo) ? (
                    <img 
                      src={isEditing ? currentApp?.logo : newApp.logo} 
                      alt="Logo Preview" 
                      className="w-full h-full object-contain p-2"
                    />
                  ) : (
                    <Globe className="w-8 h-8 text-gray-300" />
                  )}
                </div>
                <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                  Upload Logo
                  <input 
                    type="file" 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => handleLogoUpload(e, isEditing)}
                  />
                </label>
                <p className="text-[10px] text-gray-400 mt-1">Max 500KB</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Aplikasi</label>
                <input 
                  type="text" 
                  value={isEditing ? currentApp?.label : newApp.label}
                  onChange={(e) => isEditing 
                    ? setCurrentApp(prev => prev ? {...prev, label: e.target.value} : null)
                    : setNewApp({...newApp, label: e.target.value})
                  }
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all"
                  placeholder="Contoh: Stream"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL Aplikasi</label>
                <input 
                  type="text" 
                  value={isEditing ? currentApp?.url : newApp.url}
                  onChange={(e) => isEditing
                    ? setCurrentApp(prev => prev ? {...prev, url: e.target.value} : null)
                    : setNewApp({...newApp, url: e.target.value})
                  }
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-[#009B4F]/20 focus:border-[#009B4F] outline-none transition-all"
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="p-6 bg-gray-50 flex items-center justify-end gap-3">
              <button 
                onClick={closeSupportingAppModal}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button 
                onClick={isEditing ? handleUpdate : handleAdd}
                className="px-6 py-2 bg-[#009B4F] text-white rounded-lg hover:bg-[#008543] transition-colors font-medium cursor-pointer"
              >
                {isEditing ? 'Perbarui' : 'Simpan'}
              </button>
            </div>
          </div>
      </AnimatedModal>

      <AnimatedModal isOpen={isDeleting} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500 mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Hapus Aplikasi?</h3>
              <p className="text-gray-500">Tindakan ini tidak dapat dibatalkan. Apakah Anda yakin ingin menghapus aplikasi ini?</p>
            </div>
            <div className="p-6 bg-gray-50 flex items-center justify-center gap-3">
              <button 
                onClick={() => {
                  setIsDeleting(false);
                  setAppToDelete(null);
                }}
                className="px-6 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer font-medium"
              >
                Batal
              </button>
              <button 
                onClick={confirmDelete}
                className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium cursor-pointer"
              >
                Hapus
              </button>
            </div>
          </div>
      </AnimatedModal>
    </div>
  );
}
