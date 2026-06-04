// Component nhập serial pin — chỉ nhập tay
import { useEffect } from 'react';

export type BatteryAssignmentType = 'purchase' | 'rent';

export interface BatterySerialInputProps {
  quantity:        number;
  serials:         string[];
  assignmentType:  BatteryAssignmentType;
  onChangeSerials: (serials: string[]) => void;
  onChangeType:    (t: BatteryAssignmentType) => void;
}

const PLACEHOLDER = 'BAT00000010AA2102771260425N01119';
const VINFAST_BATTERY_RE = /^BAT[A-Z0-9]{20,}$/i;

export default function BatterySerialInput({
  quantity, serials, assignmentType,
  onChangeSerials, onChangeType,
}: BatterySerialInputProps) {

  // Đồng bộ length array với quantity
  useEffect(() => {
    if (serials.length === quantity) return;
    const next = [...serials];
    while (next.length < quantity) next.push('');
    while (next.length > quantity) next.pop();
    onChangeSerials(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity]);

  function setSerialAt(idx: number, value: string) {
    const next = [...serials];
    next[idx] = value.trim();
    onChangeSerials(next);
  }

  return (
    <div style={{
      background: '#fff7ed', border: '1px solid #fdba74',
      borderRadius: 8, padding: '10px 12px', marginTop: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9a3412', marginBottom: 8 }}>
        🔋 PIN XE — bắt buộc nhập serial
      </div>

      {/* Loại pin */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#9a3412', marginBottom: 4 }}>Loại giao dịch</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            type="button"
            onClick={() => onChangeType('purchase')}
            style={{
              padding: '8px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', textAlign: 'center',
              border: `2px solid ${assignmentType === 'purchase' ? '#16a34a' : '#fed7aa'}`,
              background: assignmentType === 'purchase' ? '#f0fdf4' : '#fff',
              color: assignmentType === 'purchase' ? '#15803d' : '#9a3412',
            }}
          >
            💵 Mua đứt
            <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}>Thu tiền pin</div>
          </button>
          <button
            type="button"
            onClick={() => onChangeType('rent')}
            style={{
              padding: '8px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', textAlign: 'center',
              border: `2px solid ${assignmentType === 'rent' ? '#7c3aed' : '#fed7aa'}`,
              background: assignmentType === 'rent' ? '#f5f3ff' : '#fff',
              color: assignmentType === 'rent' ? '#6d28d9' : '#9a3412',
            }}
          >
            📋 Thuê pin
            <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}>VinFast thu</div>
          </button>
        </div>
      </div>

      {/* Header serial */}
      <div style={{ fontSize: 11, color: '#9a3412', marginBottom: 4 }}>
        Serial ({quantity} cục pin):
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: quantity }).map((_, i) => {
          const val = serials[i] || '';
          const isValid = !val || VINFAST_BATTERY_RE.test(val);
          return (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#9a3412', minWidth: 18, fontWeight: 600 }}>{i + 1}.</span>
              <input
                className="form-control"
                placeholder={PLACEHOLDER}
                value={val}
                onChange={e => setSerialAt(i, e.target.value)}
                style={{
                  flex: 1, fontFamily: 'monospace', fontSize: 12,
                  padding: '6px 8px',
                  borderColor: isValid ? undefined : '#fca5a5',
                  background: isValid ? undefined : '#fef2f2',
                }}
                title={isValid ? '' : 'Format không khớp BAT...'}
              />
            </div>
          );
        })}
      </div>

      {assignmentType === 'rent' && (
        <div style={{ fontSize: 11, color: '#6d28d9', marginTop: 8, fontStyle: 'italic' }}>
          ℹ️ Pin thuê: đại lý chỉ ghi nhận, VinFast thu phí thuê trực tiếp với KH.
        </div>
      )}
    </div>
  );
}
