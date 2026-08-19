import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { categories, pageCategories, zonePageCategories } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(categories);
    const data = rows
      .map((r) => {
        const m = mergeRawRow(r);
        return {
          id: String(m.id),
          name: typeof m.name === 'string' ? m.name : '',
          color: typeof m.color === 'string' ? m.color : null,
          isActive: m.isActive !== false,
          description: typeof m.description === 'string' ? m.description : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

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

router.get('/zone-page', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;
    const rows = await db.select().from(zonePageCategories)
      .where(zoneId ? sql`${zonePageCategories.rawData}->>'zoneId' = ${zoneId as string} OR ${zonePageCategories.rawData}->>'zone_id' = ${zoneId as string}` : undefined);
    
    const data = rows.map(mergeRawRow);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[categories/zone-page]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories — Create a song category
router.post('/', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const categoryId = body.id || `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const row = {
      id: categoryId,
      rawData: {
        id: categoryId,
        name: body.name || '',
        description: body.description || '',
        color: body.color || '#8B5CF6',
        icon: body.icon || 'Tag',
        isActive: body.isActive !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...body,
      },
    };

    await db.insert(categories).values(row);
    res.status(201).json({ success: true, message: 'Category created', data: mergeRawRow(row) });
  } catch (err) {
    console.error('[categories POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /categories/:id — Update a song category
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const categoryId = req.params.id;
    const body = req.body || {};

    const [existing] = await db.select().from(categories).where(sql`${categories.id} = ${categoryId}`).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Category not found' });
      return;
    }

    const prevRaw = (existing.rawData || {}) as Record<string, unknown>;
    const updatedRaw = {
      ...prevRaw,
      ...body,
      updatedAt: new Date().toISOString(),
    };

    await db.update(categories).set({ rawData: updatedRaw }).where(sql`${categories.id} = ${categoryId}`);
    res.json({ success: true, message: 'Category updated', data: mergeRawRow({ id: categoryId, rawData: updatedRaw }) });
  } catch (err) {
    console.error('[categories PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// DELETE /categories/:id — Delete a song category
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const categoryId = req.params.id;
    await db.delete(categories).where(sql`${categories.id} = ${categoryId}`);
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    console.error('[categories DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /categories/page — Create a page/program category
router.post('/page', requireAuth, async (req, res) => {
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
router.patch('/page/:id', requireAuth, async (req, res) => {
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
router.delete('/page/:id', requireAuth, async (req, res) => {
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
router.post('/page/order', requireAuth, async (req, res) => {
  try {
    const { order } = req.body; // Array of { id, orderIndex } or sorted array of categories
    if (!Array.isArray(order)) {
      res.status(400).json({ success: false, error: 'Order array required' });
      return;
    }

    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      const itemId = typeof item === 'string' ? item : item.id;
      if (!itemId) continue;

      const [pCat] = await db.select().from(pageCategories).where(sql`${pageCategories.id} = ${itemId}`).limit(1);
      const [zpCat] = !pCat ? await db.select().from(zonePageCategories).where(sql`${zonePageCategories.id} = ${itemId}`).limit(1) : [null];
      const existing = pCat || zpCat;

      if (existing) {
        const prevRaw = (existing.rawData || {}) as Record<string, unknown>;
        const updatedRaw = { ...prevRaw, orderIndex: i };
        if (pCat) {
          await db.update(pageCategories).set({ rawData: updatedRaw }).where(sql`${pageCategories.id} = ${itemId}`);
        } else {
          await db.update(zonePageCategories).set({ rawData: updatedRaw }).where(sql`${zonePageCategories.id} = ${itemId}`);
        }
      }
    }

    res.json({ success: true, message: 'Page categories reordered successfully' });
  } catch (err) {
    console.error('[categories/page/order]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
