export declare const ENTITIES: readonly ['accounts', 'categories', 'transactions'];
export declare const DEFAULT_RATES: Record<string, number>;

type Rec = Record<string, unknown> & { id: string };

export interface MockStore {
  handle(req: unknown): Record<string, unknown>;
  serverEdit(entity: string, record: Rec): Rec;
  dump(): Record<string, unknown>;
  db: Record<'accounts' | 'categories' | 'transactions', Map<string, Rec>>;
  rates: Record<string, number>;
  settings: Record<string, unknown>;
  key: string;
}

export declare function createMockStore(opts?: {
  seed?: boolean;
  key?: string;
  now?: () => number;
  state?: unknown;
}): MockStore;

export declare function seedData(today?: Date): Record<'accounts' | 'categories' | 'transactions', Rec[]>;
