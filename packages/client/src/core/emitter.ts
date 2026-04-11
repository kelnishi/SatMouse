/** Minimal typed event emitter — no node:events dependency for browser compatibility */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEmitter<Events> {
  private listeners = new Map<string, Set<Function>>();

  on<K extends string & keyof Events>(event: K, listener: Events[K] & Function): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off<K extends string & keyof Events>(event: K, listener: Events[K] & Function): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  protected emit<K extends string & keyof Events>(
    event: K,
    ...args: Events[K] extends (...a: infer A) => void ? A : never
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        (fn as Function)(...args);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
