// 아주 단순한 메모리 캐시. 같은 검색을 반복하지 않아 무료 쿼터를 아낍니다.
// (서버가 재시작되면 비워집니다. 시연용 결과는 data/demo 에 저장해 두세요.)
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  if (store.size > 500) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  return value;
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
