// Node 22+ exposes an experimental global `localStorage` that is undefined
// unless `--localstorage-file` is passed, which breaks any module that reads
// localStorage at import time (e.g. the zustand store initialisation).
// Provide an in-memory Storage before test modules are loaded.
const memory = new Map<string, string>();

const localStorage: Storage = {
  get length() {
    return memory.size;
  },
  clear() {
    memory.clear();
  },
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null;
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value));
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: localStorage,
});
