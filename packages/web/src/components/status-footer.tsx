import { useCameraContext } from "@/features/scanner/api/use-camera";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { useSerial } from "@/features/scanner/api/use-serial";
import { createSyncEventSource } from "@/lib/api/admin";
import { useRole } from "@/hooks/use-role";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SyncState } from "@magic-vault/shared";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function FooterDivider() {
  return <span className="h-3 w-px bg-border shrink-0" />;
}

const DEFAULT_SYNC_STATE: SyncState = {
  status: "idle",
  gameKey: "",
  total: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  startedAt: null,
  logs: [],
};

function StatusDot({ variant }: { variant: "success" | "warning" | "error" | "muted" }) {
  const colors = {
    success: "bg-green-500",
    warning: "bg-amber-500 animate-pulse",
    error: "bg-red-500",
    muted: "bg-muted-foreground/30",
  };
  return <span className={`size-1.5 rounded-full shrink-0 ${colors[variant]}`} />;
}

function StatusItem({
  label,
  dot,
  tooltip,
}: {
  label: string;
  dot: "success" | "warning" | "error" | "muted";
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger className="flex items-center gap-1.5 cursor-default">
        <StatusDot variant={dot} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function SyncStatusItem() {
  const [syncState, setSyncState] = useState<SyncState>(DEFAULT_SYNC_STATE);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isAdmin } = useRole();

  useEffect(() => {
    if (!isAdmin) return;

    let es: EventSource | null = null;
    let cancelled = false;

    async function connect() {
      try {
        es = await createSyncEventSource();
        if (cancelled) {
          es.close();
          return;
        }

        es.addEventListener("status", (e: MessageEvent) => {
          setSyncState(JSON.parse(e.data) as SyncState);
        });
        es.addEventListener("progress", (e: MessageEvent) => {
          setSyncState((prev) => ({ ...prev, ...JSON.parse(e.data) }));
        });
        es.addEventListener("done", (e: MessageEvent) => {
          setSyncState((prev) => ({ ...prev, ...JSON.parse(e.data) }));
        });
        es.addEventListener("error", (e: MessageEvent) => {
          if (e.data) setSyncState((prev) => ({ ...prev, status: "failed" }));
        });
      } catch {
        // ignore
      }
    }

    connect();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [isAdmin]);

  if (!isAdmin) return null;

  const { status, total, processed, skipped } = syncState;
  const done = processed + skipped;

  const visible = status !== "idle" && status !== "cancelled" && pathname !== "/app/admin";
  if (!visible) return null;

  const dot =
    status === "running"
      ? "warning"
      : status === "completed"
        ? "success"
        : status === "failed"
          ? "error"
          : "muted";

  const countLabel =
    status === "running" && total > 0
      ? `Sync ${done.toLocaleString()}/${total.toLocaleString()}`
      : `Sync ${status}`;

  const tooltip =
    status === "running"
      ? `Syncing card image vectors${syncState.currentCard ? `: ${syncState.currentCard}` : "…"}`
      : status === "completed"
        ? "Card image vector sync completed"
        : status === "failed"
          ? "Card image vector sync failed"
          : "Card image vector sync";

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={() => navigate("/app/admin")}
        className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors min-w-0"
      >
        <StatusDot variant={dot} />
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {countLabel}
        </span>
        {status === "running" && syncState.currentCard && (
          <span className="text-xs text-muted-foreground/70 truncate max-w-32">
            — {syncState.currentCard}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function StatusFooter() {
  const { status: cameraStatus } = useCameraContext();
  const { isConnected, isReady } = useSerial();
  const { cards } = useScannedCards();

  const totalValue = cards.reduce(
    (sum, { card }) => sum + parseFloat(card.prices.usd ?? "0"),
    0,
  );

  const cameraDot =
    cameraStatus === "ready"
      ? "success"
      : cameraStatus === "error"
        ? "error"
        : cameraStatus === "requesting"
          ? "warning"
          : "muted";

  const cameraTooltip =
    cameraStatus === "ready"
      ? "Camera connected"
      : cameraStatus === "error"
        ? "Camera error"
        : cameraStatus === "requesting"
          ? "Requesting camera access…"
          : "No camera";

  const deviceDot = !isConnected ? "muted" : !isReady ? "warning" : "success";
  const deviceTooltip = !isConnected
    ? "No sorter connected"
    : !isReady
      ? "Sorter connected, running self-test…"
      : "Sorter ready";

  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <div className="flex items-center gap-3">
        <StatusItem label="Camera" dot={cameraDot} tooltip={cameraTooltip} />
        <StatusItem label="Sorter" dot={deviceDot} tooltip={deviceTooltip} />
        <SyncStatusItem />
      </div>
      {cards.length > 0 && (
        <>
          <FooterDivider />
          <p className="text-xs tabular-nums">
            {cards.length} card{cards.length !== 1 ? "s" : ""} · $
            {totalValue.toFixed(2)}
          </p>
        </>
      )}
    </div>
  );
}
