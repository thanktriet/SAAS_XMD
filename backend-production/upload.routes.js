const router  = require('express').Router();
const multer  = require('multer');
const { authenticate } = require('./auth.middleware');
const { uploadImage, deleteImage } = require('./upload.controller');

// Lưu file trong bộ nhớ (buffer) — không ghi ra disk
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file ảnh (JPEG, PNG, WEBP, GIF)'));
  },
});

// Tất cả route yêu cầu đăng nhập
router.use(authenticate);

// POST /api/upload/image — field "file"
router.post('/image', upload.single('file'), uploadImage);

// DELETE /api/upload/image — body { url }
router.delete('/image', deleteImage);

module.exports = router;
