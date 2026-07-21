import type { AiMessageAttachment } from "../../shared/ai";

const DATABASE_NAME = "orbitssh-ai-attachments";
const DATABASE_VERSION = 1;
const STORE_NAME = "attachments";

interface StoredAiAttachment extends AiMessageAttachment {
  dataUrl: string;
}

function openAttachmentDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("附件存储打开失败"));
  });
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("附件存储操作失败"));
    operation(transaction.objectStore(STORE_NAME), resolve);
  });
}

export async function saveAiAttachments(
  attachments: AiMessageAttachment[],
): Promise<void> {
  const records = attachments.filter(
    (attachment): attachment is StoredAiAttachment =>
      Boolean(attachment.id && attachment.dataUrl),
  );
  if (records.length === 0) return;

  const database = await openAttachmentDatabase();
  if (!database) return;
  try {
    await runTransaction<void>(database, "readwrite", (store, resolve) => {
      for (const record of records) store.put({ ...record });
      store.transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}

export async function loadAiAttachments(
  attachments: AiMessageAttachment[],
): Promise<AiMessageAttachment[]> {
  if (attachments.length === 0) return [];
  const database = await openAttachmentDatabase();
  if (!database) return attachments;

  try {
    return await runTransaction<AiMessageAttachment[]>(
      database,
      "readonly",
      (store, resolve) => {
        const restored = new Map<string, StoredAiAttachment>();
        let remaining = attachments.length;
        const finishOne = () => {
          remaining -= 1;
          if (remaining !== 0) return;
          resolve(
            attachments.map(attachment =>
              restored.has(attachment.id)
                ? { ...attachment, dataUrl: restored.get(attachment.id)!.dataUrl }
                : attachment,
            ),
          );
        };

        for (const attachment of attachments) {
          const request = store.get(attachment.id);
          request.onsuccess = () => {
            if (request.result) {
              restored.set(attachment.id, request.result as StoredAiAttachment);
            }
            finishOne();
          };
          request.onerror = finishOne;
        }
      },
    );
  } finally {
    database.close();
  }
}

export async function deleteAiAttachments(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openAttachmentDatabase();
  if (!database) return;

  try {
    await runTransaction<void>(database, "readwrite", (store, resolve) => {
      for (const id of ids) store.delete(id);
      store.transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}
