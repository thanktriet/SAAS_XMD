// Hook tiện ích để upload ảnh lên Supabase Storage qua backend API
import { useState, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';

interface UseUploadImageOptions {
  bucket?: string;   // tên bucket Supabase Storage (mặc định "vehicle-images")
  folder?: string;   // thư mục con (VD: "vehicles", "accessories")
  maxSizeMB?: number;
}

interface UseUploadImageReturn {
  uploading: boolean;
  upload: (file: File) => Promise<string | null>;  // trả URL hoặc null nếu lỗi
}

export function useUploadImage(options: UseUploadImageOptions = {}): UseUploadImageReturn {
  const { bucket = 'vehicle-images', folder = '', maxSizeMB = 5 } = options;
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(async (file: File): Promise<string | null> => {
    // Kiểm tra client-side trước khi gửi lên server
    const MIME_ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!MIME_ALLOWED.includes(file.type)) {
      toast.error('Chỉ chấp nhận ảnh JPEG, PNG, WEBP, GIF');
      return null;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast.error(`Ảnh tối đa ${maxSizeMB}MB`);
      return null;
    }

    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const { data } = await api.post<{ url: string }>('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params:  { bucket, folder: folder || undefined },
      });
      return data.url;
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Lỗi upload ảnh';
      toast.error(msg);
      return null;
    } finally {
      setUploading(false);
    }
  }, [bucket, folder, maxSizeMB]);

  return { uploading, upload };
}
