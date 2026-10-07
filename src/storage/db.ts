import { accountKeyOf } from '../domain/parseBackup';

// 注意：这个名字**不要改**。IndexedDB 是按名字隔离的，改名等于换一个空数据库，
// 用户已导入的账号数据会全部"消失"。项目改名（roco-toolbox）不影响它。
export const DB_NAME = 'locke-toolbox';
export const STORE_SNAPSHOTS = 'snapshots';
export const STORE_SETTINGS = 'settings';
/**
 * 快照主键字段 = 账号身份（游戏 UID，见 `domain/parseBackup.ts` 的 `accountKeyOf`）。
 *
 * v1 的主键是 `accountName`，两个**重名但不同 UID** 的真实账号只能存下一个
 * （第二个导入时被当成「重名冲突」丢弃）。v2 换成 UID 后两者可以并存。
 */
export const SNAPSHOT_KEY_FIELD = 'accountKey';
export const DB_VERSION = 2;

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: SNAPSHOT_KEY_FIELD });
        return;
      }
      // upgrade 事务在 onupgradeneeded 里一定有；这里只是让类型收窄
      if (!transaction) return;
      if (transaction.objectStore(STORE_SNAPSHOTS).keyPath === SNAPSHOT_KEY_FIELD) return;
      // v1 → v2：把旧记录（主键 = accountName）搬到新 store（主键 = accountKey）。
      // 旧记录本身带 accountName / gameId，补一个 accountKey 即可，数据一条不丢。
      const legacy = transaction.objectStore(STORE_SNAPSHOTS);
      const records: Array<Record<string, unknown>> = [];
      legacy.openCursor().onsuccess = function onCursor(this: IDBRequest<IDBCursorWithValue | null>) {
        const cursor = this.result;
        if (cursor) {
          records.push(cursor.value as Record<string, unknown>);
          cursor.continue();
          return;
        }
        db.deleteObjectStore(STORE_SNAPSHOTS);
        const fresh = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: SNAPSHOT_KEY_FIELD });
        for (const record of records) {
          const accountName = typeof record.accountName === 'string' ? record.accountName : '';
          const gameId = typeof record.gameId === 'number' ? record.gameId : 0;
          fresh.put({ ...record, [SNAPSHOT_KEY_FIELD]: accountKeyOf({ accountName, gameId }) });
        }
      };
    };
    // 另一个标签页还持着旧版本连接时，升级会先卡在 blocked。不给回调的话 Promise 永不
    // settle，调用方（读快照）会一直卡在「正在读取本地数据」。
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('本地数据库正在被其他标签页占用，请关掉其它页面后重试'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        // blocked 之后又开出来了：直接关掉，别泄漏连接
        db.close();
        return;
      }
      settled = true;
      // 本页持有的连接会阻塞别的标签页升级；收到 versionchange 主动让路
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error);
    };
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function readAll<T>(storeName: string): Promise<T[]> {
  return openDatabase().then((db) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    return promisifyRequest<T[]>(request).finally(() => db.close());
  });
}

export function write<T>(storeName: string, value: T, key?: IDBValidKey): Promise<void> {
  return openDatabase().then((db) => {
    try {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      if (key !== undefined) store.put(value, key);
      else store.put(value);
      return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      // 同步抛出（缺 store / 值不可结构化克隆）也要关连接，否则连接泄漏并阻塞后续版本升级
      db.close();
      throw error;
    }
  });
}

/**
 * 一次事务批量写入（2026-10-06 修复 M6）：同主键天然覆盖。
 * 之前调用方逐条 await write()，每个账号各开一次库 + 一次事务，
 * 账号多时明显慢，且中途失败会停在半途；批量写入是原子的，全成或全不成。
 */
export function writeMany<T>(storeName: string, values: T[]): Promise<void> {
  return openDatabase().then((db) => {
    try {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      for (const value of values) store.put(value);
      return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      db.close();
      throw error;
    }
  });
}

export function remove(storeName: string, key: IDBValidKey): Promise<void> {
  return openDatabase().then((db) => {
    try {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      store.delete(key);
      return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      db.close();
      throw error;
    }
  });
}

/** 清空某个 object store 的全部记录（保留 store 本身）。 */
export function clear(storeName: string): Promise<void> {
  return openDatabase().then((db) => {
    try {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).clear();
      return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      db.close();
      throw error;
    }
  });
}
