export type Listener<T> = (payload: T) => void;

export class EventEmitter<E extends object> {
  private listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {};

  on<K extends keyof E>(event: K, cb: Listener<E[K]>): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(cb);
    return () => this.off(event, cb);
  }

  off<K extends keyof E>(event: K, cb: Listener<E[K]>): void {
    this.listeners[event]?.delete(cb);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.listeners[event]?.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error("[event] listener error", event, err);
      }
    });
  }

  clear(): void {
    this.listeners = {};
  }
}
