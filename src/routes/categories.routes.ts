import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth, requireTenantAdmin } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

// GET /categories
router.get('/', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;

    // Always fetch global baseline categories
    const globalRows = await prisma.category.findMany();
    const globalList = globalRows.map((r) => {
      const m = mergeRawRow(r);
      return {
        id: String(m.id),
        name: typeof m.name === 'string' ? m.name : '',
        color: typeof m.color === 'string' ? m.color : null,
        isActive: m.isActive !== false,
        description: typeof m.description === 'string' ? m.description : null,
        isGlobal: true,
      };
    });

    let zoneList: any[] = [];
    if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      const target = String(zoneId).toLowerCase();
      const withoutHyphen = target.replace(/-/g, '');
      const withHyphen = target.includes('-') ? target : target.replace(/^zone(\d+)$/, 'zone-$1');

      const zoneRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM zone_categories
         WHERE lower(replace(raw_data->>'zoneId', '-', '')) = $1
            OR lower(replace(raw_data->>'zone_id', '-', '')) = $1
            OR lower(raw_data->>'zoneId') = $2
            OR lower(raw_data->>'zone_id') = $2`,
        withoutHyphen,
        withHyphen,
      );
      zoneList = zoneRows.map((r) => {
        const m = mergeRawRow(r);
        return {
          id: String(m.id),
          name: typeof m.name === 'string' ? m.name : '',
          color: typeof m.color === 'string' ? m.color : null,
          isActive: m.isActive !== false,
          description: typeof m.description === 'string' ? m.description : null,
          zoneId: m.zoneId || m.zone_id || zoneId,
          isGlobal: false,
        };
      });
    }

    // Merge zone items with global baseline (zone items override global if same name)
    const mergedMap = new Map<string, any>();
    globalList.forEach((c) => { if (c.name) mergedMap.set(c.name.toLowerCase().trim(), c); });
    zoneList.forEach((c) => { if (c.name) mergedMap.set(c.name.toLowerCase().trim(), c); });

    const data = Array.from(mergedMap.values());
    data.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[categories]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// GET /categories/page
router.get('/page', requireAuth, async (_req, res) => {
  try {
    const rows = await prisma.pageCategory.findMany();
    res.json({ success: true, data: rows.map(mergeRawRow) });
  } catch (err) {
    console.error('[categories/page]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// GET /categories/zone-page
router.get('/zone-page', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const effectiveZoneId = (req.query.zoneId && req.query.zoneId !== 'all')
      ? String(req.query.zoneId)
      : (!isHqAdmin ? (auth.zoneId as string | null) : null);

    let rows: any[];
    if (effectiveZoneId && effectiveZoneId !== 'all') {
      const withoutHyphen = effectiveZoneId.replace(/-/g, '').toLowerCase();
      const withHyphen = effectiveZoneId.includes('-') ? effectiveZoneId.toLowerCase() : effectiveZoneId.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');

      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM zone_page_categories
         WHERE lower(replace(raw_data->>'zoneId', '-', '')) = $1
            OR lower(replace(raw_data->>'zone_id', '-', '')) = $1
            OR lower(raw_data->>'zoneId') = $2
            OR lower(raw_data->>'zone_id') = $2`,
        withoutHyphen,
        withHyphen,
      );
    } else {
      rows = await prisma.zonePageCategory.findMany();
    }

    res.json({ success: true, data: rows.map(mergeRawRow) });
  } catch (err) {
    console.error('[categories/zone-page]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories
router.post('/', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const { name, color, description, zoneId } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }
    const id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const rawData = {
      id, name: name.trim(), color: color || '#9333ea',
      description: description?.trim() || null, isActive: true,
      zoneId: zoneId || 'global', createdAt: new Date().toISOString(),
    };

    let row: any;
    if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      row = await prisma.zoneCategory.create({ data: { id, rawData } });
    } else {
      row = await prisma.category.create({ data: { id, rawData } });
    }

    res.status(201).json({ success: true, message: 'Category created', data: mergeRawRow(row) });
  } catch (err) {
    console.error('[categories POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /categories/:id
router.patch('/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const categoryId = req.params.id;
    const body = req.body || {};

    const existing = await prisma.category.findUnique({ where: { id: categoryId } });
    if (existing) {
      const updatedRaw = { ...(existing.rawData as Record<string, unknown> || {}), ...body, updatedAt: new Date().toISOString() };
      await prisma.category.update({ where: { id: categoryId }, data: { rawData: updatedRaw } });
      res.json({ success: true, message: 'Category updated', data: mergeRawRow({ id: categoryId, rawData: updatedRaw }) });
      return;
    }

    const zoneExisting = await prisma.zoneCategory.findUnique({ where: { id: categoryId } });
    if (zoneExisting) {
      const updatedRaw = { ...(zoneExisting.rawData as Record<string, unknown> || {}), ...body, updatedAt: new Date().toISOString() };
      await prisma.zoneCategory.update({ where: { id: categoryId }, data: { rawData: updatedRaw } });
      res.json({ success: true, message: 'Category updated', data: mergeRawRow({ id: categoryId, rawData: updatedRaw }) });
      return;
    }

    res.status(404).json({ success: false, error: 'Category not found' });
  } catch (err) {
    console.error('[categories PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// DELETE /categories/:id
router.delete('/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const categoryId = req.params.id;
    await Promise.allSettled([
      prisma.category.delete({ where: { id: categoryId } }),
      prisma.zoneCategory.delete({ where: { id: categoryId } }),
    ]);
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    console.error('[categories DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories/page
router.post('/page', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const pageCatId = body.id || `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const zoneId = body.zoneId || body.zone_id;
    const rawData = { id: pageCatId, name: body.name || '', description: body.description || '', image: body.image || '', zoneId: zoneId || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...body };

    let row: any;
    if (zoneId && zoneId !== 'zone-001' && !zoneId.toLowerCase().includes('hq') && zoneId !== 'ZONE001') {
      row = await prisma.zonePageCategory.create({ data: { id: pageCatId, rawData } });
    } else {
      row = await prisma.pageCategory.create({ data: { id: pageCatId, rawData } });
    }
    res.status(201).json({ success: true, message: 'Page category created', data: mergeRawRow(row) });
  } catch (err) {
    console.error('[categories/page POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /categories/page/:id
router.patch('/page/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const pageCatId = req.params.id;
    const body = req.body || {};

    const pCat = await prisma.pageCategory.findUnique({ where: { id: pageCatId } });
    const zpCat = !pCat ? await prisma.zonePageCategory.findUnique({ where: { id: pageCatId } }) : null;
    const existing = pCat || zpCat;
    if (!existing) return res.status(404).json({ success: false, error: 'Page category not found' });

    const updatedRaw = { ...(existing.rawData as Record<string, unknown> || {}), ...body, updatedAt: new Date().toISOString() };
    if (pCat) {
      await prisma.pageCategory.update({ where: { id: pageCatId }, data: { rawData: updatedRaw } });
    } else {
      await prisma.zonePageCategory.update({ where: { id: pageCatId }, data: { rawData: updatedRaw } });
    }
    res.json({ success: true, message: 'Page category updated', data: mergeRawRow({ id: pageCatId, rawData: updatedRaw }) });
  } catch (err) {
    console.error('[categories/page PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// DELETE /categories/page/:id
router.delete('/page/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const pageCatId = req.params.id;
    await Promise.allSettled([
      prisma.pageCategory.delete({ where: { id: pageCatId } }),
      prisma.zonePageCategory.delete({ where: { id: pageCatId } }),
    ]);
    res.json({ success: true, message: 'Page category deleted' });
  } catch (err) {
    console.error('[categories/page DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories/page/order
router.post('/page/order', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const rawOrder = Array.isArray(req.body) ? req.body : req.body?.order;
    if (!Array.isArray(rawOrder)) return res.status(400).json({ success: false, error: 'Order array required' });
    const zoneId = req.body?.zoneId;

    for (let i = 0; i < rawOrder.length; i++) {
      const item = rawOrder[i];
      const itemId = typeof item === 'string' ? item : (item.id || item.firebaseId || item._id);
      if (!itemId) continue;

      const pCat = await prisma.pageCategory.findUnique({ where: { id: String(itemId) } });
      const zpCat = !pCat ? await prisma.zonePageCategory.findUnique({ where: { id: String(itemId) } }) : null;
      const existing = pCat || zpCat;

      if (existing) {
        const updatedRaw = { ...(existing.rawData as Record<string, unknown> || {}), ...(typeof item === 'object' ? item : {}), orderIndex: i, order: i };
        if (pCat) {
          await prisma.pageCategory.update({ where: { id: String(itemId) }, data: { rawData: updatedRaw } });
        } else {
          await prisma.zonePageCategory.update({ where: { id: String(itemId) }, data: { rawData: updatedRaw } });
        }
      } else if (typeof item === 'object') {
        const rawData = { ...item, orderIndex: i, order: i, ...(zoneId ? { zoneId } : {}) };
        try {
          if (zoneId && zoneId !== 'zone-001' && !zoneId.toLowerCase().includes('hq')) {
            await prisma.zonePageCategory.create({ data: { id: String(itemId), rawData } });
          } else {
            await prisma.pageCategory.create({ data: { id: String(itemId), rawData } });
          }
        } catch { /* already exists, skip */ }
      }
    }

    res.json({ success: true, message: 'Page categories reordered successfully' });
  } catch (err) {
    console.error('[categories/page/order]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
