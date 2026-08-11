import { LOCAL_USER_ID } from "@poke-sort/shared";
import { createLockEventsSource } from "@/lib/api/session";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export interface ScanLockInfo {
  userId: string;
  displayName: string;
  expiresAt: number;
}

interface CollectionLocksContextValue {
  locks: Record<string, ScanLockInfo>;
  currentUserId: string | undefined;
  isLockedByOther: (guid: string) => boolean;
}

const CollectionLocksContext = createContext<CollectionLocksContextValue>({
  locks: {},
  currentUserId: undefined,
  isLockedByOther: () => false,
});

export function CollectionLocksProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locks, setLocks] = useState<Record<string, ScanLockInfo>>({});
  // Single local user, so lock ownership is a constant. `isLockedByOther` is
  // therefore always false: one machine cannot lock itself out. Two scanners
  // racing for the same collection is not a scenario for a desktop build.
  const currentUserId = LOCAL_USER_ID;

  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    createLockEventsSource()
      .then((es) => {
        if (cancelled) {
          es.close();
          return;
        }
        esRef.current = es;

        es.addEventListener("init", (e) => {
          const { locks: initial } = JSON.parse((e as MessageEvent).data) as {
            locks: Record<string, ScanLockInfo>;
          };
          setLocks(initial);
        });

        es.addEventListener("lock_acquired", (e) => {
          const { guid, userId, displayName } = JSON.parse(
            (e as MessageEvent).data,
          ) as { guid: string; userId: string; displayName: string };
          setLocks((prev) => ({
            ...prev,
            [guid]: {
              userId,
              displayName,
              expiresAt: Date.now() + 5 * 60 * 1000,
            },
          }));
        });

        es.addEventListener("lock_released", (e) => {
          const { guid } = JSON.parse((e as MessageEvent).data) as {
            guid: string;
          };
          setLocks((prev) => {
            const next = { ...prev };
            delete next[guid];
            return next;
          });
        });
      })
      .catch(() => {
        /* silent - will degrade gracefully */
      });

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  const isLockedByOther = (guid: string) => {
    const lock = locks[guid];
    return !!(lock && lock.userId !== currentUserId);
  };

  return (
    <CollectionLocksContext value={{ locks, currentUserId, isLockedByOther }}>
      {children}
    </CollectionLocksContext>
  );
}

export function useCollectionLocks() {
  return useContext(CollectionLocksContext);
}
