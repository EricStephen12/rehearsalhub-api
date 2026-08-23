import { Router } from 'express';
import multer from 'multer';
import { uploadToR2 } from '../services/r2Service';
import { requireAuth } from '../auth/auth.middleware';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150 MB max per file
  },
});

// Upload media directly to Cloudflare R2
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    const folder = (req.body.folder || 'general').toString();
    const result = await uploadToR2(file.buffer, {
      folder,
      filename: file.originalname,
      contentType: file.mimetype,
    });

    res.json({
      success: true,
      data: {
        url: result.url,
        key: result.key,
        size: result.size,
        name: file.originalname,
        mimeType: file.mimetype,
      },
    });
  } catch (error: any) {
    console.error('[UploadRoute] Error uploading to R2:', error);
    res.status(500).json({ success: false, error: error.message || 'Upload failed' });
  }
});

// Public upload for registration avatars if unauthenticated
router.post('/public', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    const folder = (req.body.folder || 'public').toString();
    const result = await uploadToR2(file.buffer, {
      folder,
      filename: file.originalname,
      contentType: file.mimetype,
    });

    res.json({
      success: true,
      data: {
        url: result.url,
        key: result.key,
        size: result.size,
        name: file.originalname,
        mimeType: file.mimetype,
      },
    });
  } catch (error: any) {
    console.error('[UploadRoute] Error uploading public file to R2:', error);
    res.status(500).json({ success: false, error: error.message || 'Upload failed' });
  }
});

export default router;
