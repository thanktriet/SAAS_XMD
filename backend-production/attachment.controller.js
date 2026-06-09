const { supabaseAdmin } = require('./config/supabase');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

function getDb(req) { return req.db || supabaseAdmin; }

const UPLOAD_DIR = path.join(__dirname, 'uploads', 'attachments');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// GET /api/sales/:id/attachments
const getAttachments = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const { data, error } = await getDb(req).from('sales_order_attachments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/sales/:id/attachments
const uploadAttachment = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Không có file đính kèm' });

    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    const storedName = `${fileId}${ext}`;
    const destPath = path.join(UPLOAD_DIR, storedName);

    fs.writeFileSync(destPath, file.buffer);

    const { data, error } = await getDb(req).from('sales_order_attachments')
      .insert([{
        id: fileId,
        order_id: orderId,
        file_name: file.originalname,
        stored_name: storedName,
        mime_type: file.mimetype,
        size_bytes: file.size,
        uploaded_by: req.user?.sub || null,
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/sales/:id/attachments/:attachmentId — replace file
const replaceAttachment = async (req, res) => {
  try {
    const { id: orderId, attachmentId } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Không có file đính kèm' });

    // Lấy record cũ
    const { data: existing } = await getDb(req).from('sales_order_attachments')
      .select('stored_name')
      .eq('id', attachmentId)
      .eq('order_id', orderId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Không tìm thấy file' });

    // Xoá file cũ
    const oldPath = path.join(UPLOAD_DIR, existing.stored_name);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

    // Lưu file mới
    const ext = path.extname(file.originalname);
    const storedName = `${attachmentId}${ext}`;
    const destPath = path.join(UPLOAD_DIR, storedName);
    fs.writeFileSync(destPath, file.buffer);

    const { data, error } = await getDb(req).from('sales_order_attachments')
      .update({
        file_name: file.originalname,
        stored_name: storedName,
        mime_type: file.mimetype,
        size_bytes: file.size,
        uploaded_by: req.user?.sub || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', attachmentId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/sales/:id/attachments/:attachmentId
const deleteAttachment = async (req, res) => {
  try {
    const { id: orderId, attachmentId } = req.params;

    const { data: existing } = await getDb(req).from('sales_order_attachments')
      .select('stored_name')
      .eq('id', attachmentId)
      .eq('order_id', orderId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Không tìm thấy file' });

    // Xoá file
    const filePath = path.join(UPLOAD_DIR, existing.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Xoá record
    const { error } = await getDb(req).from('sales_order_attachments')
      .delete()
      .eq('id', attachmentId);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã xoá file' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/sales/:id/attachments/:attachmentId/download
const downloadAttachment = async (req, res) => {
  try {
    const { id: orderId, attachmentId } = req.params;

    const { data: att } = await getDb(req).from('sales_order_attachments')
      .select('*')
      .eq('id', attachmentId)
      .eq('order_id', orderId)
      .single();

    if (!att) return res.status(404).json({ error: 'Không tìm thấy file' });

    const filePath = path.join(UPLOAD_DIR, att.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File không tồn tại trên server' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.file_name)}"`);
    res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getAttachments, uploadAttachment, replaceAttachment, deleteAttachment, downloadAttachment };
