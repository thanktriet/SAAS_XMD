// Hồ sơ đính kèm cho đơn hàng — list / upload thêm / replace / xoá / tải về
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatDate } from '../utils/helpers';
import toast from 'react-hot-toast';

interface AttachmentDto {
  id:           string;
  order_id:     string;
  file_name:    string;
  mime_type:    string | null;
  size_bytes:   number | null;
  uploaded_by:  string | null;
  created_at:   string;
  updated_at:   string;
}

const C = {
  accent: '#2563eb',
  muted:  '#6b7280',
  red:    '#dc2626',
  border: '#f1f5f9',
};

const cardStyle: React.CSSProperties = {
  background:   '#fff',
  borderRadius: 12,
  boxShadow:    '0 1px 4px rgba(0,0,0,0.06)',
  border:       `1px solid ${C.border}`,
  padding:      20,
  marginBottom: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize:      13,
  fontWeight:    600,
  color:         C.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom:  12,
  marginTop:     0,
};

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return '—';
  const KB = 1024, MB = KB * 1024;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(0)} KB`;
  return `${n} B`;
}

function fileIcon(mime: string | null): string {
  if (!mime) return '📎';
  if (mime.startsWith('image/'))                return '🖼️';
  if (mime === 'application/pdf')               return '📕';
  if (mime.includes('word'))                    return '📘';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📗';
  if (mime.startsWith('text/'))                 return '📄';
  return '📎';
}

interface Props {
  orderId: string;
  /** Khi đơn ở trạng thái cuối (cancelled/delivered) thì khoá thao tác sửa */
  readOnly?: boolean;
}

export default function AttachmentsPanel({ orderId, readOnly = false }: Props) {
  const qc = useQueryClient();
  const addInputRef     = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  // ── List ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['attachments', orderId],
    queryFn:  () => api.get(`/sales/${orderId}/attachments`).then(r => r.data),
    enabled:  !!orderId,
  });
  const attachments: AttachmentDto[] = data?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['attachments', orderId] });

  // ── Upload thêm ───────────────────────────────────────────────────────
  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const r = await api.post(`/sales/${orderId}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      return r.data;
    },
    onSuccess: (res) => {
      const n = res?.data?.length ?? 0;
      toast.success(`Đã tải lên ${n} tệp`);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Tải lên thất bại'),
  });

  // ── Replace ───────────────────────────────────────────────────────────
  const replaceMut = useMutation({
    mutationFn: async (vars: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append('file', vars.file);
      const r = await api.put(`/sales/${orderId}/attachments/${vars.id}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      return r.data;
    },
    onSuccess: () => { toast.success('Đã thay tệp'); invalidate(); },
    onError:   (e: any) => toast.error(e?.response?.data?.error || 'Thay tệp thất bại'),
  });

  // ── Delete ────────────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/sales/${orderId}/attachments/${id}`).then(r => r.data),
    onSuccess: () => { toast.success('Đã xoá tệp'); invalidate(); },
    onError:   (e: any) => toast.error(e?.response?.data?.error || 'Xoá tệp thất bại'),
  });

  // ── Download (cần token Authorization → fetch blob rồi trigger save) ──
  const handleDownload = async (att: AttachmentDto) => {
    try {
      const r = await api.get(`/sales/${orderId}/attachments/${att.id}/download`, {
        responseType: 'blob',
        timeout: 60000,
      });
      const blob = new Blob([r.data], { type: att.mime_type ?? 'application/octet-stream' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = att.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Không tải được tệp');
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────
  const onPickAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) uploadMut.mutate(files);
  };

  const onPickReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && replacingId) {
      replaceMut.mutate({ id: replacingId, file });
    }
    setReplacingId(null);
  };

  const triggerReplace = (id: string) => {
    setReplacingId(id);
    setTimeout(() => replaceInputRef.current?.click(), 0);
  };

  const handleDelete = (att: AttachmentDto) => {
    if (window.confirm(`Xoá vĩnh viễn tệp "${att.file_name}"?`)) {
      deleteMut.mutate(att.id);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ ...sectionTitleStyle, marginBottom: 0 }}>📎 Hồ sơ đính kèm{attachments.length > 0 && ` (${attachments.length})`}</p>
        {!readOnly && (
          <button
            type="button"
            onClick={() => addInputRef.current?.click()}
            disabled={uploadMut.isPending}
            style={{
              padding: '6px 12px',
              border: `1px solid ${C.accent}`,
              background: uploadMut.isPending ? '#e5e7eb' : C.accent,
              color: '#fff',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: uploadMut.isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {uploadMut.isPending ? 'Đang tải…' : '+ Tải lên'}
          </button>
        )}
      </div>

      {/* input ẩn — thêm mới */}
      <input
        ref={addInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onPickAdd}
      />
      {/* input ẩn — thay thế */}
      <input
        ref={replaceInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={onPickReplace}
      />

      {isLoading ? (
        <div style={{ fontSize: 13, color: C.muted, padding: 8 }}>Đang tải danh sách…</div>
      ) : attachments.length === 0 ? (
        <div style={{
          fontSize: 13, color: C.muted, padding: '14px 8px',
          textAlign: 'center', background: '#f9fafb', borderRadius: 8,
          border: `1px dashed ${C.border}`,
        }}>
          Chưa có tệp đính kèm
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attachments.map(att => {
            const isReplacing = replaceMut.isPending && replacingId === att.id;
            const isDeleting  = deleteMut.isPending  && deleteMut.variables === att.id;
            return (
              <div key={att.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: '#f9fafb',
                border: `1px solid ${C.border}`,
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 20 }}>{fileIcon(att.mime_type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: '#1f2937',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={att.file_name}>
                    {att.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    {formatBytes(att.size_bytes)} · {formatDate(att.created_at)}
                  </div>
                </div>

                <button
                  type="button"
                  title="Tải xuống"
                  onClick={() => handleDownload(att)}
                  style={btnStyle(C.accent)}
                >
                  ⬇
                </button>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      title="Thay tệp khác"
                      onClick={() => triggerReplace(att.id)}
                      disabled={isReplacing}
                      style={btnStyle('#6b7280', isReplacing)}
                    >
                      {isReplacing ? '…' : '↻'}
                    </button>
                    <button
                      type="button"
                      title="Xoá"
                      onClick={() => handleDelete(att)}
                      disabled={isDeleting}
                      style={btnStyle(C.red, isDeleting)}
                    >
                      {isDeleting ? '…' : '×'}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
          Hỗ trợ ảnh, PDF, Word, Excel, txt — tối đa 10MB/tệp.
        </div>
      )}
    </div>
  );
}

function btnStyle(color: string, disabled = false): React.CSSProperties {
  return {
    width: 28, height: 28,
    border: `1px solid ${color}`,
    background: disabled ? '#e5e7eb' : '#fff',
    color: disabled ? '#9ca3af' : color,
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };
}
