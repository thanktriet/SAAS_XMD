const path = require('path');
const fs = require('fs');

// Các loại ảnh hợp lệ
const MIME_ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
// Dung lượng tối đa: 5 MB
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// Thư mục upload
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Đảm bảo thư mục tồn tại
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * POST /api/upload/image
 * Body: multipart/form-data, field "file"
 * Query: bucket (mặc định "vehicle-images"), folder (mặc định "")
 * Trả về: { url: "/uploads/vehicle-images/..." }
 */
const uploadImage = async (req, res) => {
  try {
    const file = req.file; // được inject bởi multer (memoryStorage)
    if (!file) {
      return res.status(400).json({ error: 'Vui lòng chọn file ảnh' });
    }

    // Kiểm tra loại file
    if (!MIME_ALLOWED.includes(file.mimetype)) {
      return res.status(400).json({ error: `Chỉ chấp nhận: ${MIME_ALLOWED.join(', ')}` });
    }

    // Kiểm tra dung lượng
    if (file.size > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: 'Ảnh tối đa 5MB' });
    }

    const bucket = req.query.bucket || 'vehicle-images';
    const folder = req.query.folder ? `${req.query.folder}/` : '';
    const ext    = path.extname(file.originalname).toLowerCase() || '.jpg';

    // Tạo tên file duy nhất: <timestamp>-<random>.<ext>
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const relativePath = `${bucket}/${folder}${fileName}`;

    // Đảm bảo thư mục tồn tại
    const targetDir = path.join(UPLOAD_DIR, bucket, folder);
    ensureDir(targetDir);

    // Ghi file ra disk
    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    // Trả về URL tương đối (serve bởi express.static)
    const url = `/uploads/${relativePath}`;
    res.status(201).json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/upload/image
 * Body: { url: "/uploads/..." }
 * Xoá file khỏi local filesystem
 */
const deleteImage = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Thiếu url' });

    // Trích path từ URL: /uploads/<bucket>/<path>
    const prefix = '/uploads/';
    const idx = url.indexOf(prefix);
    if (idx === -1) return res.status(400).json({ error: 'URL không hợp lệ' });

    const relativePath = decodeURIComponent(url.slice(idx + prefix.length));
    const filePath = path.join(UPLOAD_DIR, relativePath);

    // Kiểm tra file tồn tại
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File không tồn tại' });
    }

    fs.unlinkSync(filePath);
    res.json({ message: 'Đã xoá ảnh' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { uploadImage, deleteImage };
