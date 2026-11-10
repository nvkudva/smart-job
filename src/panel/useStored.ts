import { useEffect, useState } from "preact/hooks";
import * as storage from "../storage.ts";

/** Live view of one storage key; undefined until first load. */
export function useStored<K extends keyof storage.StoreShape>(key: K): storage.StoreShape[K] | undefined {
  const [value, setValue] = useState<storage.StoreShape[K]>();
  useEffect(() => {
    let isAlive = true;
    const load = () => void storage.get(key).then((loaded) => isAlive && setValue(loaded));
    load();
    const stopListening = storage.onChange((keys) => keys.includes(key) && load());
    return () => {
      isAlive = false;
      stopListening();
    };
  }, [key]);
  return value;
}
