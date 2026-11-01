/**
 * Recorded drives, kept in this browser (IndexedDB). A drive is a table: one column per value,
 * one row per dashboard update, stored metric. Nothing leaves the laptop unless you export it.
 */

export interface DriveColumn {
  key: string;
  name: string;
  unit: string;
}

export interface Drive {
  id?: number;
  vehicleId: string;
  vehicleName: string;
  startedAt: number;
  endedAt: number;
  columns: DriveColumn[];
  /** [ms since start, ...one value per column (null if not read that cycle)] */
  rows: (number | null)[][];
}

const DB = 'obd2';
const STORE = 'drives';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open browser storage'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Browser storage failed'));
      }),
  );
}

export const saveDrive = (d: Drive) => tx<IDBValidKey>('readwrite', (s) => s.put(d)).then((id) => id as number);
export const listDrives = () => tx<Drive[]>('readonly', (s) => s.getAll()).then((all) => all.sort((a, b) => b.startedAt - a.startedAt));
export const deleteDrive = (id: number) => tx<undefined>('readwrite', (s) => s.delete(id));
