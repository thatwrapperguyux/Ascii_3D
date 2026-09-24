import type { SettingKey, Settings } from './schema';

export type ChangeListener = (changed: ReadonlySet<SettingKey>, settings: Readonly<Settings>) => void;

/** A tiny observable settings object. Listeners receive the set of keys that changed. */
export class SettingsStore {
  private readonly state: Settings;
  private readonly listeners = new Set<ChangeListener>();

  constructor(initial: Settings) {
    this.state = { ...initial };
  }

  get value(): Readonly<Settings> {
    return this.state;
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    return this.state[key];
  }

  set(patch: Partial<Settings>): void {
    const changed = new Set<SettingKey>();
    const target = this.state as Record<SettingKey, unknown>;
    for (const key of Object.keys(patch) as SettingKey[]) {
      const next = patch[key];
      if (next === undefined || target[key] === next) continue;
      target[key] = next;
      changed.add(key);
    }
    if (changed.size === 0) return;
    for (const listener of this.listeners) listener(changed, this.state);
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
