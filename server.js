const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const db = require('./db');
const archiver = require('archiver');
const unzipper = require('unzipper');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure dirs exist
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const VEHICLE_IMG_DIR = path.join(UPLOADS_DIR, 'vehicles');
const RECEIPT_DIR = path.join(UPLOADS_DIR, 'receipts');
const ENTRY_PHOTO_DIR = path.join(UPLOADS_DIR, 'entry_photos');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(VEHICLE_IMG_DIR, { recursive: true });
fs.mkdirSync(RECEIPT_DIR, { recursive: true });
fs.mkdirSync(ENTRY_PHOTO_DIR, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Static
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const sanitizeFilename = (name) => name.replace(/[^a-z0-9.-]+/gi, '_');

// Convert a web path like '/uploads/vehicles/abc.jpg' to an absolute FS path inside UPLOADS_DIR
function webToFsPath(p) {
  if (!p) return null;
  const prefix = '/uploads/';
  let rel = p.startsWith(prefix) ? p.slice(prefix.length) : p.replace(/^\/+/, '');
  const abs = path.normalize(path.join(UPLOADS_DIR, rel));
  // ensure it stays within uploads dir
  if (!abs.startsWith(path.normalize(UPLOADS_DIR))) return null;
  return abs;
}

const vehicleImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VEHICLE_IMG_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${sanitizeFilename(ext)}`);
  }
});
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RECEIPT_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${sanitizeFilename(ext)}`);
  }
});

// Entry files (photos[] and receipt) in one handler
const entryFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'photos') return cb(null, ENTRY_PHOTO_DIR);
    if (file.fieldname === 'receipt') return cb(null, RECEIPT_DIR);
    return cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${sanitizeFilename(ext)}`);
  }
});

const uploadVehicleImage = multer({
  storage: vehicleImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed for vehicle image'));
  }
});
const uploadReceipt = multer({
  storage: receiptStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Only image or PDF files are allowed for receipt'));
  }
});

const uploadEntryFiles = multer({
  storage: entryFileStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'photos') {
      if (file.mimetype.startsWith('image/')) return cb(null, true);
      return cb(new Error('Photos must be image files'));
    }
    if (file.fieldname === 'receipt') {
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') return cb(null, true);
      return cb(new Error('Receipt must be image or PDF'));
    }
    return cb(new Error('Unexpected field'));
  }
});

// ZIP uploads for full restore (use memory storage; adjust size limit if needed)
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});

// VIN decode via NHTSA
app.get('/api/vin/:vin', async (req, res) => {
  const { vin } = req.params;
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
    const response = await axios.get(url);
    const raw = response.data;
    let simplified = null;
    if (raw && raw.Results && raw.Results[0]) {
      const r = raw.Results[0];
      simplified = {
        Make: r.Make || '',
        Model: r.Model || '',
        ModelYear: r.ModelYear || '',
        BodyClass: r.BodyClass || '',
        EngineCylinders: r.EngineCylinders || '',
        DisplacementL: r.DisplacementL || r.DisplacementCC || '',
        FuelTypePrimary: r.FuelTypePrimary || '',
        Trim: r.Trim || '',
        DriveType: r.DriveType || '',
        TransmissionStyle: r.TransmissionStyle || '',
        PlantCountry: r.PlantCountry || ''
      };
    }
    res.json({ ok: true, simplified, raw });
  } catch (err) {
    console.error('VIN decode error', err.message);
    res.status(500).json({ ok: false, error: 'VIN decode failed' });
  }
});

function parseIntOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function parseFloatOrNull(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// Vehicles
app.get('/api/vehicles', (req, res) => {
  const includeStats = req.query.includeStats === '1';
  const vehicles = db.listVehicles();
  if (!includeStats) return res.json({ ok: true, vehicles });
  const enriched = vehicles.map(v => {
    const last = db.getLastServiceEntry(v.id);
    const summary = computeSummary(v, last);
    return { ...v, summary };
  });
  res.json({ ok: true, vehicles: enriched });
});

app.get('/api/vehicles/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const v = db.getVehicle(id);
  if (!v) return res.status(404).json({ ok: false, error: 'Not found' });
  const last = db.getLastServiceEntry(id);
  res.json({ ok: true, vehicle: v, lastService: last, summary: computeSummary(v, last) });
});

app.post('/api/vehicles', uploadVehicleImage.single('image'), (req, res) => {
  try {
    const body = req.body;
    const image_path = req.file ? `/uploads/vehicles/${path.basename(req.file.path)}` : null;
    const vehicle = db.createVehicle({
      nickname: body.nickname || '',
      year: parseIntOrNull(body.year),
      make: body.make || '',
      model: body.model || '',
      vin: (body.vin || '').trim(),
      owner_first: body.owner_first || '',
      owner_last: body.owner_last || '',
      current_mileage: parseIntOrNull(body.current_mileage) || 0,
      oil_quarts: parseFloatOrNull(body.oil_quarts),
      oil_weight: body.oil_weight || '',
      service_interval_miles: parseIntOrNull(body.service_interval_miles) || 5000,
      service_interval_months: parseIntOrNull(body.service_interval_months) || 6,
      image_path,
      vin_decoded_json: body.vin_decoded_json || null
    });
    res.status(201).json({ ok: true, vehicle });
  } catch (err) {
    console.error('Create vehicle error', err);
    res.status(400).json({ ok: false, error: 'Failed to create vehicle' });
  }
});

app.put('/api/vehicles/:id', uploadVehicleImage.single('image'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.getVehicle(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  try {
    let image_path = existing.image_path;
    if (req.file) {
      // delete old
      if (image_path) {
        const p = webToFsPath(image_path);
        if (p) { try { fs.unlinkSync(p); } catch {} }
      }
      image_path = `/uploads/vehicles/${path.basename(req.file.path)}`;
    }
    const body = req.body;
    const vehicle = db.updateVehicle(id, {
      nickname: body.nickname ?? existing.nickname,
      year: parseIntOrNull(body.year) ?? existing.year,
      make: body.make ?? existing.make,
      model: body.model ?? existing.model,
      vin: (body.vin ?? existing.vin).trim(),
      owner_first: body.owner_first ?? existing.owner_first,
      owner_last: body.owner_last ?? existing.owner_last,
      current_mileage: parseIntOrNull(body.current_mileage) ?? existing.current_mileage,
      oil_quarts: parseFloatOrNull(body.oil_quarts) ?? existing.oil_quarts,
      oil_weight: body.oil_weight ?? existing.oil_weight,
      service_interval_miles: parseIntOrNull(body.service_interval_miles) ?? existing.service_interval_miles,
      service_interval_months: parseIntOrNull(body.service_interval_months) ?? existing.service_interval_months,
      image_path,
      vin_decoded_json: body.vin_decoded_json ?? existing.vin_decoded_json
    });
    res.json({ ok: true, vehicle });
  } catch (err) {
    console.error('Update vehicle error', err);
    res.status(400).json({ ok: false, error: 'Failed to update vehicle' });
  }
});

app.delete('/api/vehicles/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.getVehicle(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  try {
    // delete image
    if (existing.image_path) {
      const p = webToFsPath(existing.image_path);
      if (p) { try { fs.unlinkSync(p); } catch {} }
    }
    // delete receipts for this vehicle
    const entries = db.listServiceEntries(id);
    entries.forEach(e => {
      if (e.receipt_path) {
        const p = webToFsPath(e.receipt_path);
        if (p) { try { fs.unlinkSync(p); } catch {} }
      }
      // delete photos for entry
      try {
        const photos = JSON.parse(e.photo_paths_json || '[]');
        for (const ph of photos) {
          const fp = webToFsPath(ph);
          if (fp) { try { fs.unlinkSync(fp); } catch {} }
        }
      } catch {}
    });
    db.deleteVehicle(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete vehicle error', err);
    res.status(400).json({ ok: false, error: 'Failed to delete vehicle' });
  }
});

// Service entries
app.get('/api/vehicles/:id/service-entries', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const entries = db.listServiceEntries(id);
  res.json({ ok: true, entries });
});

app.get('/api/service-entries/:entryId', (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const entry = db.getServiceEntry(entryId);
  if (!entry) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, entry });
});

app.post('/api/vehicles/:id/service-entries', uploadEntryFiles.fields([{ name: 'photos', maxCount: 10 }, { name: 'receipt', maxCount: 1 }]), (req, res) => {
  const vehicle_id = parseInt(req.params.id, 10);
  const v = db.getVehicle(vehicle_id);
  if (!v) return res.status(404).json({ ok: false, error: 'Vehicle not found' });
  try {
    const body = req.body;
    const receipt_path = (req.files && req.files.receipt && req.files.receipt[0])
      ? `/uploads/receipts/${path.basename(req.files.receipt[0].path)}`
      : null;
    const photos_files = (req.files && req.files.photos) || [];
    const photo_paths = photos_files.map(f => `/uploads/entry_photos/${path.basename(f.path)}`);
    const entry = db.createServiceEntry(vehicle_id, {
      date: body.date,
      mileage: parseIntOrNull(body.mileage),
      oil_brand: body.oil_brand || '',
      oil_weight: body.oil_weight || '',
      oil_quarts: parseFloatOrNull(body.oil_quarts),
      filter_brand: body.filter_brand || '',
      filter_part: body.filter_part || '',
      notes: body.notes || '',
      receipt_path,
      photo_paths
    });
    // Update vehicle mileage if higher
    if (entry.mileage && entry.mileage > (v.current_mileage || 0)) {
      db.updateVehicle(vehicle_id, { ...v, current_mileage: entry.mileage });
    }
    res.status(201).json({ ok: true, entry });
  } catch (err) {
    console.error('Create service entry error', err);
    res.status(400).json({ ok: false, error: 'Failed to create service entry' });
  }
});

app.put('/api/service-entries/:entryId', uploadEntryFiles.fields([{ name: 'photos', maxCount: 10 }, { name: 'receipt', maxCount: 1 }]), (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const existing = db.getServiceEntry(entryId);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  try {
    let receipt_path = existing.receipt_path;
    // photos handling
    let photos = [];
    try { photos = JSON.parse(existing.photo_paths_json || '[]'); } catch { photos = []; }
    // removal of selected photos
    if (req.body.remove_photo_paths) {
      try {
        const toRemove = JSON.parse(req.body.remove_photo_paths);
        if (Array.isArray(toRemove) && toRemove.length) {
          photos = photos.filter(p => {
            if (toRemove.includes(p)) {
              const fp = webToFsPath(p);
              if (fp) { try { fs.unlinkSync(fp); } catch {} }
              return false;
            }
            return true;
          });
        }
      } catch {}
    }
    // append newly uploaded photos
    const newPhotos = (req.files && req.files.photos) || [];
    if (newPhotos.length) {
      const added = newPhotos.map(f => `/uploads/entry_photos/${path.basename(f.path)}`);
      photos = photos.concat(added);
    }
    if (req.body.remove_receipt === 'true') {
      if (receipt_path) {
        const p = webToFsPath(receipt_path);
        if (p) { try { fs.unlinkSync(p); } catch {} }
      }
      receipt_path = null;
    }
    if (req.files && req.files.receipt && req.files.receipt[0]) {
      if (receipt_path) {
        const pOld = webToFsPath(receipt_path);
        if (pOld) { try { fs.unlinkSync(pOld); } catch {} }
      }
      receipt_path = `/uploads/receipts/${path.basename(req.files.receipt[0].path)}`;
    }
    const body = req.body;
    const entry = db.updateServiceEntry(entryId, {
      date: body.date ?? existing.date,
      mileage: parseIntOrNull(body.mileage) ?? existing.mileage,
      oil_brand: body.oil_brand ?? existing.oil_brand,
      oil_weight: body.oil_weight ?? existing.oil_weight,
      oil_quarts: parseFloatOrNull(body.oil_quarts) ?? existing.oil_quarts,
      filter_brand: body.filter_brand ?? existing.filter_brand,
      filter_part: body.filter_part ?? existing.filter_part,
      notes: body.notes ?? existing.notes,
      receipt_path,
      photo_paths: photos
    });
    // Possibly update vehicle mileage
    const v = db.getVehicle(existing.vehicle_id);
    if (entry.mileage && entry.mileage > (v.current_mileage || 0)) {
      db.updateVehicle(v.id, { ...v, current_mileage: entry.mileage });
    }
    res.json({ ok: true, entry });
  } catch (err) {
    console.error('Update service entry error', err);
    res.status(400).json({ ok: false, error: 'Failed to update service entry' });
  }
});

app.delete('/api/service-entries/:entryId', (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const existing = db.getServiceEntry(entryId);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  try {
    if (existing.receipt_path) {
      const p = webToFsPath(existing.receipt_path);
      if (p) { try { fs.unlinkSync(p); } catch {} }
    }
    // delete any photos
    try {
      const photos = JSON.parse(existing.photo_paths_json || '[]');
      for (const ph of photos) {
        const fp = webToFsPath(ph);
        if (fp) { try { fs.unlinkSync(fp); } catch {} }
      }
    } catch {}
    db.deleteServiceEntry(entryId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete service entry error', err);
    res.status(400).json({ ok: false, error: 'Failed to delete service entry' });
  }
});

// Backup/Restore
app.get('/api/backup', (req, res) => {
  try {
    const snapshot = db.exportAll();
    res.setHeader('Content-Disposition', `attachment; filename=oil-change-backup-${Date.now()}.json`);
    res.json({ ok: true, ...snapshot });
  } catch (err) {
    console.error('Backup error', err);
    res.status(500).json({ ok: false, error: 'Backup failed' });
  }
});

// Full ZIP backup: includes db.json and entire uploads directory
app.get('/api/backup/full', (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=oil-change-backup-${Date.now()}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { console.error('Archiver error', err); try{res.status(500).end();}catch{} });
    archive.pipe(res);

    const snapshot = db.exportAll();
    archive.append(Buffer.from(JSON.stringify({ ok: true, ...snapshot }, null, 2)), { name: 'db.json' });
    if (fs.existsSync(UPLOADS_DIR)) {
      archive.directory(UPLOADS_DIR, 'uploads');
    }
    archive.finalize();
  } catch (err) {
    console.error('Full backup error', err);
    res.status(500).json({ ok: false, error: 'Full backup failed' });
  }
});

app.post('/api/restore', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload.schema !== 'string' || !/^oil-change-tracker@/.test(payload.schema)) {
      return res.status(400).json({ ok: false, error: 'Invalid backup format' });
    }
    db.restoreAll(payload);
    res.json({ ok: true });
  } catch (err) {
    console.error('Restore error', err);
    res.status(500).json({ ok: false, error: 'Restore failed' });
  }
});

// Full ZIP restore: expects multipart/form-data with field 'file' (zip)
app.post('/api/restore/full', uploadZip.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ ok: false, error: 'No zip provided' });
    const directory = await unzipper.Open.buffer(req.file.buffer);
    // Find db.json (allow nested path just in case)
    const dbEntry = directory.files.find(f => /(^|\/)db\.json$/.test(f.path));
    if (!dbEntry) return res.status(400).json({ ok: false, error: 'db.json missing from archive' });
    const dbContent = await dbEntry.buffer();
    let payload;
    try { payload = JSON.parse(dbContent.toString('utf8')); } catch { return res.status(400).json({ ok: false, error: 'Invalid db.json' }); }
    if (!payload || typeof payload.schema !== 'string' || !/^oil-change-tracker@/.test(payload.schema)) {
      return res.status(400).json({ ok: false, error: 'Unsupported backup schema' });
    }

    // Wipe uploads directory to mirror archive contents
    try { fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(VEHICLE_IMG_DIR, { recursive: true });
    fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    fs.mkdirSync(ENTRY_PHOTO_DIR, { recursive: true });

    // Extract uploads/* entries
    const uploadsRootNorm = path.normalize(UPLOADS_DIR) + path.sep;
    for (const f of directory.files) {
      if (!f.path.startsWith('uploads/')) continue;
      const rel = f.path.substring('uploads/'.length);
      const dest = path.join(UPLOADS_DIR, rel);
      const normDest = path.normalize(dest);
      if (!normDest.startsWith(uploadsRootNorm)) continue; // prevent traversal
      if (f.type === 'Directory') {
        fs.mkdirSync(normDest, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(normDest), { recursive: true });
        const content = await f.buffer();
        fs.writeFileSync(normDest, content);
      }
    }

    // Restore DB
    db.restoreAll(payload);
    res.json({ ok: true });
  } catch (err) {
    console.error('Full restore error', err);
    res.status(500).json({ ok: false, error: 'Full restore failed' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Summary computation
function computeSummary(vehicle, last) {
  if (!last) return { status: 'no_history', message: 'No service history yet' };
  const milesInterval = vehicle.service_interval_miles || 5000;
  const monthsInterval = vehicle.service_interval_months || 6;
  const nextMileage = (last.mileage || 0) + milesInterval;
  const lastDate = new Date(last.date);
  const nextDate = new Date(lastDate);
  nextDate.setMonth(nextDate.getMonth() + monthsInterval);
  const today = new Date();
  const daysRemaining = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
  const milesRemaining = nextMileage - (vehicle.current_mileage || 0);
  let status = 'ok';
  if (daysRemaining <= 0 || milesRemaining <= 0) status = 'due';
  else if (daysRemaining <= 14 || milesRemaining <= 300) status = 'soon';
  return {
    status,
    lastDate: last.date,
    lastMileage: last.mileage,
    nextMileage,
    nextDate: nextDate.toISOString().slice(0,10),
    daysRemaining,
    milesRemaining
  };
}

app.listen(PORT, () => {
  console.log(`Oil Change Tracker running on http://localhost:${PORT}`);
});
