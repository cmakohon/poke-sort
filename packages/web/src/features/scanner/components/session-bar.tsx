import { DeleteDialog } from "@/components/delete-dialog";
import { Button } from "@/components/ui/button";
import { DynamicDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCollections } from "@/features/collections/api/use-collections";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { IconDeviceFloppy, IconLoader2, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * What ends a scan run.
 *
 * Scanning used to write straight into the active collection, so there was no
 * end to a run and no way to throw one away — the only escape was emptying the
 * collection afterwards. Staged cards now need an explicit decision: save them
 * somewhere, or discard them. Either way the scan_events behind them survive,
 * so discarding costs the review screen nothing.
 */
export function SessionBar() {
  const { t } = useTranslation("cards");
  const { cards, session, saveSession, discardSession, isClosingSession } =
    useScannedCards();
  const { collections } = useCollections();

  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [destination, setDestination] = useState<string | undefined>(undefined);

  // Default the destination to the run's target, but only while the dialog is
  // shut — reopening should not stomp on a choice the operator just made.
  useEffect(() => {
    if (!saveOpen) setDestination(session?.targetCollectionGuid ?? undefined);
  }, [saveOpen, session?.targetCollectionGuid]);

  const target = useMemo(
    () => collections.find((c) => c.guid === session?.targetCollectionGuid),
    [collections, session?.targetCollectionGuid],
  );
  const chosen = useMemo(
    () => collections.find((c) => c.guid === destination),
    [collections, destination],
  );

  // The staged cards were identified against the target's game and language.
  // Saving them somewhere else is allowed — the operator may have picked the
  // wrong collection at the start — but it is worth saying out loud, because
  // nothing re-identifies the cards on the way in.
  const mismatch =
    !!chosen &&
    !!target &&
    (chosen.game?.key !== target.game?.key || chosen.lang !== target.lang);

  if (!session || cards.length === 0) return null;

  const startedAt = new Date(session.startedAt);

  return (
    <>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-px h-5 bg-border mx-1 shrink-0" />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {t("sessionBar.staged", { count: cards.length })}
          {" · "}
          {t("sessionBar.started", {
            time: startedAt.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            }),
            date: startedAt.toLocaleDateString(),
          })}
        </span>
        <Button
          size="sm"
          disabled={isClosingSession}
          onClick={() => setSaveOpen(true)}
        >
          {isClosingSession ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconDeviceFloppy className="size-4" />
          )}
          {t("sessionBar.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isClosingSession}
          onClick={() => setDiscardOpen(true)}
        >
          <IconTrash className="size-4" />
          {t("sessionBar.discard")}
        </Button>
      </div>

      <DynamicDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title={t("sessionBar.saveDialog.title")}
        description={t("sessionBar.saveDialog.description", {
          count: cards.length,
        })}
        trigger={<span />}
        footer={
          <>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              {t("sessionBar.saveDialog.cancel")}
            </Button>
            <Button
              disabled={!destination || isClosingSession}
              onClick={async () => {
                if (!destination) return;
                await saveSession(destination);
                setSaveOpen(false);
              }}
            >
              {isClosingSession && (
                <IconLoader2 className="size-4 animate-spin" />
              )}
              {t("sessionBar.saveDialog.confirm")}
            </Button>
          </>
        }
        footerClassName="flex-col-reverse md:flex-row"
      >
        <div className="flex flex-col gap-2">
          <Select
            value={destination}
            onValueChange={(value) => setDestination(value ?? undefined)}
          >
            <SelectTrigger>
              {/* The label has to be supplied explicitly — left to itself
                  SelectValue renders the raw value, which here is a guid. */}
              <SelectValue
                placeholder={t("sessionBar.saveDialog.selectPlaceholder")}
              >
                {chosen?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {collections.map((c) => (
                <SelectItem key={c.guid} value={c.guid}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mismatch && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {t("sessionBar.saveDialog.gameMismatch", {
                target: target?.name ?? "",
                destination: chosen?.name ?? "",
              })}
            </p>
          )}
        </div>
      </DynamicDialog>

      <DeleteDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("sessionBar.discardDialog.title", { count: cards.length })}
        description={t("sessionBar.discardDialog.description")}
        confirm={{ type: "keyword" }}
        confirmLabel={t("sessionBar.discardDialog.confirm")}
        onConfirm={() => {
          void discardSession();
          setDiscardOpen(false);
        }}
      />
    </>
  );
}
