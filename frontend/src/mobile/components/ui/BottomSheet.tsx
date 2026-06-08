import { useEffect, useRef } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="m-bottomsheet-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="m-bottomsheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="m-bottomsheet-handle" />
        <div className="m-bottomsheet-header">
          <h3 className="m-bottomsheet-title">{title}</h3>
          <button className="m-bottomsheet-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="m-bottomsheet-body">
          {children}
        </div>
      </div>
    </div>
  );
}
