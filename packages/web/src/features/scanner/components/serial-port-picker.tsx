import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconUsb } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Asks which attached device is the sorter.
 *
 * Only appears when the choice is genuinely ambiguous: more than one physical
 * USB device is attached and none is the one already remembered. With a single
 * device — the normal case on a dedicated machine — the shell picks it and this
 * never renders.
 *
 * The page's `navigator.serial.requestPort()` is suspended while this is open,
 * so the dialog is deliberately not dismissible by clicking away: leaving it
 * unanswered would leave Connect spinning with no explanation. Cancel is
 * explicit, and rejects the request the way declining a browser prompt does.
 */

interface OfferedPort {
  portId: string;
  portName?: string;
  displayName?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

interface DesktopSerialBridge {
  onSelectRequest?: (listener: (ports: OfferedPort[]) => void) => () => void;
  respondToSelect?: (portId: string | null) => void;
}

function bridge(): DesktopSerialBridge | null {
  const w = window as unknown as { pokeSort?: { serial?: DesktopSerialBridge } };
  return w.pokeSort?.serial ?? null;
}

/** A device's most human name, falling back through what it reports. */
function portLabel(port: OfferedPort): string {
  return port.displayName || port.portName || port.portId.slice(0, 8);
}

function portDetail(port: OfferedPort): string {
  const ids = [port.vendorId, port.productId].filter(Boolean).join(":");
  // The serial number is what actually distinguishes two identical boards, so
  // it is shown when there is one rather than hidden as noise.
  return [ids && `USB ${ids}`, port.serialNumber].filter(Boolean).join(" · ");
}

export function SerialPortPicker() {
  const { t } = useTranslation("scanner");
  const [ports, setPorts] = useState<OfferedPort[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const serial = bridge();
    if (!serial?.onSelectRequest) return;
    return serial.onSelectRequest((offered) => {
      setPorts(offered);
      setSelected(offered[0]?.portId ?? null);
    });
  }, []);

  const respond = useCallback((portId: string | null) => {
    bridge()?.respondToSelect?.(portId);
    setPorts(null);
    setSelected(null);
  }, []);

  if (!ports || ports.length === 0) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("serialPicker.title")}</DialogTitle>
          <DialogDescription>{t("serialPicker.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {ports.map((port) => {
            const active = port.portId === selected;
            return (
              <button
                key={port.portId}
                type="button"
                onClick={() => setSelected(port.portId)}
                onDoubleClick={() => respond(port.portId)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-input hover:bg-muted",
                )}
              >
                <IconUsb className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex flex-col">
                  <span className="text-sm font-medium truncate">
                    {portLabel(port)}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {portDetail(port)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {t("serialPicker.remembered")}
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => respond(null)}>
            {t("serialPicker.cancel")}
          </Button>
          <Button disabled={!selected} onClick={() => respond(selected)}>
            {t("serialPicker.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
