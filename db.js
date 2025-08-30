const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.db');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Schema
const createVehicles = `
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  vin TEXT,
  owner_first TEXT,
  owner_last TEXT,
  current_mileage INTEGER DEFAULT 0,
  oil_quarts REAL,
  oil_weight TEXT,
  service_interval_miles INTEGER DEFAULT 5000,
  service_interval_months INTEGER DEFAULT 6,
  image_path TEXT,
  vin_decoded_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

const createServiceEntries = `
CREATE TABLE IF NOT EXISTS service_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  mileage INTEGER,
  oil_brand TEXT,
  oil_weight TEXT,
  oil_quarts REAL,
  filter_brand TEXT,
  filter_part TEXT,
  notes TEXT,
  receipt_path TEXT,
  photo_paths_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);
`;

db.exec(createVehicles);
db.exec(createServiceEntries);

// Migration: ensure photo_paths_json exists on older databases
try {
  const cols = db.prepare("PRAGMA table_info('service_entries')").all();
  const hasPhotos = cols.some(c => c.name === 'photo_paths_json');
  if (!hasPhotos) {
    db.exec("ALTER TABLE service_entries ADD COLUMN photo_paths_json TEXT DEFAULT '[]'");
  }
} catch {}

function now() { return new Date().toISOString(); }

// Vehicles CRUD
const insertVehicleStmt = db.prepare(`
INSERT INTO vehicles
(nickname, year, make, model, vin, owner_first, owner_last, current_mileage, oil_quarts, oil_weight, service_interval_miles, service_interval_months, image_path, vin_decoded_json, created_at, updated_at)
VALUES (@nickname, @year, @make, @model, @vin, @owner_first, @owner_last, @current_mileage, @oil_quarts, @oil_weight, @service_interval_miles, @service_interval_months, @image_path, @vin_decoded_json, @created_at, @updated_at)
`);

const updateVehicleStmt = db.prepare(`
UPDATE vehicles SET
 nickname=@nickname, year=@year, make=@make, model=@model, vin=@vin, owner_first=@owner_first, owner_last=@owner_last,
 current_mileage=@current_mileage, oil_quarts=@oil_quarts, oil_weight=@oil_weight,
 service_interval_miles=@service_interval_miles, service_interval_months=@service_interval_months,
 image_path=@image_path, vin_decoded_json=@vin_decoded_json, updated_at=@updated_at
WHERE id=@id
`);

const deleteVehicleStmt = db.prepare('DELETE FROM vehicles WHERE id = ?');

const getVehicleStmt = db.prepare('SELECT * FROM vehicles WHERE id = ?');
const listVehiclesStmt = db.prepare('SELECT * FROM vehicles ORDER BY updated_at DESC');

function createVehicle(v) {
  const payload = {
    nickname: v.nickname || '',
    year: v.year ?? null,
    make: v.make || '',
    model: v.model || '',
    vin: v.vin || '',
    owner_first: v.owner_first || '',
    owner_last: v.owner_last || '',
    current_mileage: v.current_mileage ?? 0,
    oil_quarts: v.oil_quarts ?? null,
    oil_weight: v.oil_weight || '',
    service_interval_miles: v.service_interval_miles ?? 5000,
    service_interval_months: v.service_interval_months ?? 6,
    image_path: v.image_path || null,
    vin_decoded_json: v.vin_decoded_json || null,
    created_at: now(),
    updated_at: now()
  };
  const info = insertVehicleStmt.run(payload);
  return getVehicle(info.lastInsertRowid);
}

function updateVehicle(id, v) {
  const existing = getVehicle(id);
  if (!existing) return null;
  const payload = {
    id,
    nickname: v.nickname ?? existing.nickname,
    year: v.year ?? existing.year,
    make: v.make ?? existing.make,
    model: v.model ?? existing.model,
    vin: v.vin ?? existing.vin,
    owner_first: v.owner_first ?? existing.owner_first,
    owner_last: v.owner_last ?? existing.owner_last,
    current_mileage: v.current_mileage ?? existing.current_mileage,
    oil_quarts: v.oil_quarts ?? existing.oil_quarts,
    oil_weight: v.oil_weight ?? existing.oil_weight,
    service_interval_miles: v.service_interval_miles ?? existing.service_interval_miles,
    service_interval_months: v.service_interval_months ?? existing.service_interval_months,
    image_path: v.image_path ?? existing.image_path,
    vin_decoded_json: v.vin_decoded_json ?? existing.vin_decoded_json,
    updated_at: now()
  };
  updateVehicleStmt.run(payload);
  return getVehicle(id);
}

function deleteVehicle(id) {
  deleteVehicleStmt.run(id);
}

function getVehicle(id) { return getVehicleStmt.get(id); }
function listVehicles() { return listVehiclesStmt.all(); }

// Service entries
const insertEntryStmt = db.prepare(`
INSERT INTO service_entries (vehicle_id, date, mileage, oil_brand, oil_weight, oil_quarts, filter_brand, filter_part, notes, receipt_path, photo_paths_json, created_at, updated_at)
VALUES (@vehicle_id, @date, @mileage, @oil_brand, @oil_weight, @oil_quarts, @filter_brand, @filter_part, @notes, @receipt_path, @photo_paths_json, @created_at, @updated_at)
`);

const updateEntryStmt = db.prepare(`
UPDATE service_entries SET
 date=@date, mileage=@mileage, oil_brand=@oil_brand, oil_weight=@oil_weight, oil_quarts=@oil_quarts,
 filter_brand=@filter_brand, filter_part=@filter_part, notes=@notes, receipt_path=@receipt_path, photo_paths_json=@photo_paths_json, updated_at=@updated_at
WHERE id=@id
`);

const deleteEntryStmt = db.prepare('DELETE FROM service_entries WHERE id = ?');
const getEntryStmt = db.prepare('SELECT * FROM service_entries WHERE id = ?');
const listEntriesStmt = db.prepare('SELECT * FROM service_entries WHERE vehicle_id = ? ORDER BY date DESC, id DESC');
const lastEntryStmt = db.prepare('SELECT * FROM service_entries WHERE vehicle_id = ? ORDER BY date DESC, id DESC LIMIT 1');

function createServiceEntry(vehicle_id, e) {
  const payload = {
    vehicle_id,
    date: e.date || new Date().toISOString().slice(0,10),
    mileage: e.mileage ?? null,
    oil_brand: e.oil_brand || '',
    oil_weight: e.oil_weight || '',
    oil_quarts: e.oil_quarts ?? null,
    filter_brand: e.filter_brand || '',
    filter_part: e.filter_part || '',
    notes: e.notes || '',
    receipt_path: e.receipt_path || null,
    photo_paths_json: Array.isArray(e.photo_paths)
      ? JSON.stringify(e.photo_paths)
      : (typeof e.photo_paths_json === 'string' ? e.photo_paths_json : '[]'),
    created_at: now(),
    updated_at: now()
  };
  const info = insertEntryStmt.run(payload);
  return getServiceEntry(info.lastInsertRowid);
}

function updateServiceEntry(id, e) {
  const existing = getServiceEntry(id);
  if (!existing) return null;
  const payload = {
    id,
    date: e.date ?? existing.date,
    mileage: e.mileage ?? existing.mileage,
    oil_brand: e.oil_brand ?? existing.oil_brand,
    oil_weight: e.oil_weight ?? existing.oil_weight,
    oil_quarts: e.oil_quarts ?? existing.oil_quarts,
    filter_brand: e.filter_brand ?? existing.filter_brand,
    filter_part: e.filter_part ?? existing.filter_part,
    notes: e.notes ?? existing.notes,
    receipt_path: e.receipt_path ?? existing.receipt_path,
    photo_paths_json: Array.isArray(e.photo_paths)
      ? JSON.stringify(e.photo_paths)
      : (e.photo_paths_json ?? existing.photo_paths_json ?? '[]'),
    updated_at: now()
  };
  updateEntryStmt.run(payload);
  return getServiceEntry(id);
}

function deleteServiceEntry(id) { deleteEntryStmt.run(id); }
function getServiceEntry(id) { return getEntryStmt.get(id); }
function listServiceEntries(vehicle_id) { return listEntriesStmt.all(vehicle_id); }
function getLastServiceEntry(vehicle_id) { return lastEntryStmt.get(vehicle_id); }

// Backup/restore
function exportAll() {
  const vehicles = listVehicles();
  const entries = db.prepare('SELECT * FROM service_entries').all();
  return {
    schema: 'oil-change-tracker@2',
    exported_at: now(),
    vehicles,
    service_entries: entries
  };
}

function restoreAll(snapshot) {
  const schema = snapshot && typeof snapshot.schema === 'string' ? snapshot.schema : '';
  if (!/^oil-change-tracker@/.test(schema)) throw new Error('Invalid backup format');
  const isV2 = /@2$/.test(schema);

  const tx = db.transaction(() => {
    db.exec('DELETE FROM service_entries');
    db.exec('DELETE FROM vehicles');

    const vInsert = db.prepare(`INSERT INTO vehicles (id, nickname, year, make, model, vin, owner_first, owner_last, current_mileage, oil_quarts, oil_weight, service_interval_miles, service_interval_months, image_path, vin_decoded_json, created_at, updated_at)
    VALUES (@id, @nickname, @year, @make, @model, @vin, @owner_first, @owner_last, @current_mileage, @oil_quarts, @oil_weight, @service_interval_miles, @service_interval_months, @image_path, @vin_decoded_json, @created_at, @updated_at)`);

    const eInsert = db.prepare(`INSERT INTO service_entries (id, vehicle_id, date, mileage, oil_brand, oil_weight, oil_quarts, filter_brand, filter_part, notes, receipt_path, photo_paths_json, created_at, updated_at)
    VALUES (@id, @vehicle_id, @date, @mileage, @oil_brand, @oil_weight, @oil_quarts, @filter_brand, @filter_part, @notes, @receipt_path, @photo_paths_json, @created_at, @updated_at)`);

    for (const v of snapshot.vehicles || []) vInsert.run(v);
    for (const e of snapshot.service_entries || []) {
      const row = isV2 ? e : { ...e, photo_paths_json: '[]' };
      eInsert.run(row);
    }
  });
  tx();
}

module.exports = {
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getVehicle,
  listVehicles,
  createServiceEntry,
  updateServiceEntry,
  deleteServiceEntry,
  getServiceEntry,
  listServiceEntries,
  getLastServiceEntry,
  exportAll,
  restoreAll
};
