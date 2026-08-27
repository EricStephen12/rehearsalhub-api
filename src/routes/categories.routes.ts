import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { categories, zoneCategories, pageCategories, zonePageCategories } from '../schema';
import { requireAuth, requireTenantAdmin } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;
    let data: any[] = [];

    if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      const target = String(zoneId).toLowerCase();
      const withoutHyphen = target.replace(/-/g, '');
      const withHyphen = target.includes('-') ? target : target.replace(/^zone(\d+)$/, 'zone-$1');

      // Fetch zone-specific categories
      const zoneRows = await db.select().from(zoneCategories).where(
        sql`lower(replace(${zoneCategories.rawData}->>'zoneId', '-', '')) = ${withoutHyphen} OR 
            lower(replace(${zoneCategories.rawData}->>'zone_id', '-', '')) = ${withoutHyphen} OR 
            lower(${zoneCategories.rawData}->>'zoneId') = ${withHyphen} OR 
            lower(${zoneCategories.rawData}->>'zone_id') = ${withHyphen}`
      );
      data = zoneRows.map((r) => {
        const m = mergeRawRow(r);
        return {
          id: String(m.id),
          name: typeof m.name === 'string' ? m.name : '',
          color: typeof m.color === 'string' ? m.color : null,
          isActive: m.isActive !== false,
          description: typeof m.description === 'string' ? m.description : null,
          zoneId: m.zoneId || m.zone_id || zoneId,
        };
      });
    } else {
      // Global HQ categories
      const rows = await db.select().from(categories);
      data = rows.map((r) => {
        const m = mergeRawRow(r);
        return {
          id: String(m.id),
          name: typeof m.name === 'string' ? m.name : '',
          color: typeof m.color === 'string' ? m.color : null,
          isActive: m.isActive !== false,
          description: typeof m.description === 'string' ? m.description : null,
        };
      });
    }

    data.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[categories]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/page', requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(pageCategories);
    const data = rows.map(mergeRawRow);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[categories/page]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/zone-page', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const effectiveZoneId = (req.query.zoneId && req.query.zoneId !== 'all') ? String(req.query.zoneId) : (!isHqAdmin ? (auth.zoneId as string | null) : null);

    let rows: any[] = [];
    if (effectiveZoneId && effectiveZoneId !== 'all') {
      const withoutHyphen = effectiveZoneId.replace(/-/g, '').toLowerCase();
      const withHyphen = effectiveZoneId.includes('-') ? effectiveZoneId.toLowerCase() : effectiveZoneId.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');

      rows = await db.select().from(zonePageCategories).where(
        sql`lower(replace(${zonePageCategories.rawData}->>'zoneId', '-', '')) = ${withoutHyphen} OR 
            lower(replace(${zonePageCategories.rawData}->>'zone_id', '-', '')) = ${withoutHyphen} OR 
            lower(${zonePageCategories.rawData}->>'zoneId') = ${withHyphen} OR 
            lower(${zonePageCategories.rawData}->>'zone_id') = ${withHyphen}`
      );
    } else {
      rows = await db.select().from(zonePageCategories);
    }
    
    const data = rows.map(mergeRawRow);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[categories/zone-page]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories — Create a song category
router.post('/', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const { name, color, description, zoneId } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }
    const id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const row = {
      id,
      rawData: {
        id,
        name: name.trim(),
        color: color || '#9333ea',
        description: description?.trim() || null,
        isActive: true,
        zoneId: zoneId || 'global',
        createdAt: new Date().toISOString(),
      },
    };

    if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      await db.insert(zoneCategories).values(row);
    } else {
      await db.insert(categories).values(row);
    }

    res.status(201).json({ success: true, message: 'Category created', data: mergeRawRow(row) });
  } catch (err) {
    console.error('[categories POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /categories/:id — Update a song category
router.patch('/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const categoryId = req.params.id;
    const body = req.body || {};

    const [existing] = await db.select().from(categories).where(sql`${categories.id} = ${categoryId}`).limit(1);
    if (existing) {
      const prevRaw = (existing.rawData || {}) as Record<string, unknown>;
      const updatedRaw = {
        ...prevRaw,
        ...body,
        updatedAt: new Date().toISOString(),
      };
      await db.update(categories).set({ rawData: updatedRaw }).where(sql`${categories.id} = ${categoryId}`);
      res.json({ success: true, message: 'Category updated', data: mergeRawRow({ id: categoryId, rawData: updatedRaw }) });
      return;
    }

    const [zoneExisting] = await db.select().from(zoneCategories).where(sql`${zoneCategories.id} = ${categoryId}`).limit(1);
    if (zoneExisting) {
      const prevRaw = (zoneExisting.rawData || {}) as Record<string, unknown>;
      const updatedRaw = {
        ...prevRaw,
        ...body,
        updatedAt: new Date().toISOString(),
      };
      await db.update(zoneCategories).set({ rawData: updatedRaw }).where(sql`${zoneCategories.id} = ${categoryId}`);
      res.json({ success: true, message: 'Category updated', data: mergeRawRow({ id: categoryId, rawData: updatedRaw }) });
      return;
    }

    res.status(404).json({ success: false, error: 'Category not found' });
  } catch (err) {
    console.error('[categories PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// DELETE /categories/:id — Delete a song category
router.delete('/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const categoryId = req.params.id;
    await db.delete(categories).where(sql`${categories.id} = ${categoryId}`);
    await db.delete(zoneCategories).where(sql`${zoneCategories.id} = ${categoryId}`);
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    console.error('[categories DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories/page — Create a page/program category
router.post('/page', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const pageCatId = body.id || `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const zoneId = body.zoneId || body.zone_id;

    const row = {
      id: pageCatId,
      rawData: {
        id: pageCatId,
        name: body.name || '',
        description: body.description || '',
        image: body.image || '',
        zoneId: zoneId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...body,
      },
    };

    if (zoneId && zoneId !== 'zone-001' && !zoneId.toLowerCase().includes('hq') && zoneId !== 'ZONE001') {
      await db.insert(zonePageCategories).values(row);
    } else {
      await db.insert(pageCategories).values(row);
    }

    res.status(201).json({ success: true, message: 'Page category created', data: mergeRawRow(row) });
  } catch (err) {
    console.error('[categories/page POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /categories/page/:id — Update a page/program category
router.patch('/page/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const pageCatId = req.params.id;
    const body = req.body || {};

    const [pCat] = await db.select().from(pageCategories).where(sql`${pageCategories.id} = ${pageCatId}`).limit(1);
    const [zpCat] = !pCat ? await db.select().from(zonePageCategories).where(sql`${zonePageCategories.id} = ${pageCatId}`).limit(1) : [null];
    const existing = pCat || zpCat;

    if (!existing) {
      res.status(404).json({ success: false, error: 'Page category not found' });
      return;
    }

    const prevRaw = (existing.rawData || {}) as Record<string, unknown>;
    const updatedRaw = {
      ...prevRaw,
      ...body,
      updatedAt: new Date().toISOString(),
    };

    if (pCat) {
      await db.update(pageCategories).set({ rawData: updatedRaw }).where(sql`${pageCategories.id} = ${pageCatId}`);
    } else {
      await db.update(zonePageCategories).set({ rawData: updatedRaw }).where(sql`${zonePageCategories.id} = ${pageCatId}`);
    }

    res.json({ success: true, message: 'Page category updated', data: mergeRawRow({ id: pageCatId, rawData: updatedRaw }) });
  } catch (err) {
    console.error('[categories/page PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// DELETE /categories/page/:id — Delete a page/program category
router.delete('/page/:id', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const pageCatId = req.params.id;
    await Promise.all([
      db.delete(pageCategories).where(sql`${pageCategories.id} = ${pageCatId}`),
      db.delete(zonePageCategories).where(sql`${zonePageCategories.id} = ${pageCatId}`),
    ]);

    res.json({ success: true, message: 'Page category deleted' });
  } catch (err) {
    console.error('[categories/page DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories/page/order — Reorder page categories
router.post('/page/order', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const rawOrder = Array.isArray(req.body) ? req.body : req.body?.order;
    if (!Array.isArray(rawOrder)) {
      res.status(400).json({ success: false, error: 'Order array required' });
      return;
    }

    const zoneId = req.body?.zoneId;

    for (let i = 0; i < rawOrder.length; i++) {
      const item = rawOrder[i];
      const itemId = typeof item === 'string' ? item : (item.id || item.firebaseId || item._id);
      if (!itemId) continue;

      const [pCat] = await db.select().from(pageCategories).where(sql`${pageCategories.id} = ${String(itemId)}`).limit(1);
      const [zpCat] = !pCat ? await db.select().from(zonePageCategories).where(sql`${zonePageCategories.id} = ${String(itemId)}`).limit(1) : [null];
      const existing = pCat || zpCat;

      if (existing) {
        const prevRaw = (existing.rawData || {}) as Record<string, unknown>;
        const updatedRaw = { ...prevRaw, ...(typeof item === 'object' ? item : {}), orderIndex: i, order: i };
        if (pCat) {
          await db.update(pageCategories).set({ rawData: updatedRaw }).where(sql`${pageCategories.id} = ${String(itemId)}`);
        } else {
          await db.update(zonePageCategories).set({ rawData: updatedRaw }).where(sql`${zonePageCategories.id} = ${String(itemId)}`);
        }
      } else if (typeof item === 'object') {
        const row = {
          id: String(itemId),
          rawData: { ...item, orderIndex: i, order: i, ...(zoneId ? { zoneId } : {}) },
        };
        try {
          if (zoneId && zoneId !== 'zone-001' && !zoneId.toLowerCase().includes('hq')) {
            await db.insert(zonePageCategories).values(row);
          } else {
            await db.insert(pageCategories).values(row);
          }
        } catch {}
      }
    }

    res.json({ success: true, message: 'Page categories reordered successfully' });
  } catch (err) {
    console.error('[categories/page/order]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
