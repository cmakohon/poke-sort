import { Button } from "@/components/ui/button";
import { CardSearchPicker } from "@/features/cards/components/card-search-picker";
import {
  useReviewDetail,
  useReviewQueue,
  useReviewStats,
  usePrefetchReviewDetails,
  useSubmitVerdict,
} from "@/features/review/api/use-review-queue";
import { CandidateRow } from "@/features/review/components/candidate-row";
import { MismatchReasonPanel } from "@/features/review/components/mismatch-reason-panel";
import { ReviewFocus } from "@/features/review/components/review-focus";
import { ReviewQueueStrip } from "@/features/review/components/review-queue-strip";
import {
  INITIAL_REVIEW_STATE,
  transition,
  type ReviewMachineEvent,
  type SaveCommand,
} from "@/features/review/lib/review-machine";
import { useReviewHotkeys } from "@/features/review/lib/use-review-hotkeys";
import { MISMATCH_REASONS } from "@poke-sort/shared";
import {
  IconCheck,
  IconChecklist,
  IconHelpCircle,
  IconLoader2,
  IconRubberStamp,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** How far ahead detail queries are warmed so advancing feels instant. */
const PREFETCH_AHEAD = 2;
/** Fetch the next queue page this many items before the end. */
const PAGE_AHEAD = 10;

export function ReviewScreen() {
  const { t } = useTranslation("review");
  const [showReviewed, setShowReviewed] = useState(false);
  const status = showReviewed ? "all" : "unreviewed";

  const queue = useReviewQueue(status);
  const { items } = queue;
  const { data: stats } = useReviewStats();
  const prefetchDetails = usePrefetchReviewDetails();
  const verdictMutation = useSubmitVerdict();

  const [index, setIndex] = useState(0);
  const [machine, setMachine] = useState(INITIAL_REVIEW_STATE);
  const [note, setNote] = useState("");
  const [rotated, setRotated] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const noteInputRef = useRef<HTMLInputElement | null>(null);

  const current = items[index];
  const { data: detail, isLoading: detailLoading } = useReviewDetail(
    current?.guid,
  );

  // A no-match scan has no accepted prediction: everything it saw becomes a
  // numbered alternate (all six the server hydrated) and there is nothing
  // for Space to confirm.
  const isNoMatch = current?.tier === "no-match";
  const predicted = !isNoMatch ? (detail?.candidates[0] ?? null) : null;
  const alternates = detail
    ? isNoMatch
      ? detail.candidates.slice(0, 6)
      : detail.candidates.slice(1, 6)
    : [];
  const hasPrediction = predicted != null;

  useEffect(() => {
    prefetchDetails(
      items.slice(index + 1, index + 1 + PREFETCH_AHEAD).map((i) => i.guid),
    );
  }, [index, items, prefetchDetails]);

  // Depend on the individual fields, not the `queue` object (a new identity
  // every render), and stop on a fetch error — otherwise a transient 500
  // near the end of the list becomes an unbounded retry loop against the
  // single-threaded PGlite server.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    queue;
  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError &&
      index >= items.length - PAGE_AHEAD
    ) {
      void fetchNextPage();
    }
  }, [
    index,
    items.length,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(next, items.length)));
    setRotated(false);
    setNote("");
    setMachine(INITIAL_REVIEW_STATE);
  };

  const performSave = (save: SaveCommand) => {
    if (!current) return;
    verdictMutation.mutate(
      {
        guid: current.guid,
        body: {
          verdict: save.verdict,
          correctedCardId: save.correctedCardId,
          mismatchReasons: save.mismatchReasons,
          note: note.trim() || undefined,
        },
      },
      {
        onError: () => toast.error(t("toast.saveFailed")),
      },
    );
    // Optimistic: advance immediately, the failure toast points back.
    goTo(index + 1);
  };

  const dispatch = (event: ReviewMachineEvent) => {
    const { state, save } = transition(machine, event, { hasPrediction });
    setMachine(state);
    if (save) performSave(save);
  };

  const toggleReviewed = () => {
    setShowReviewed((v) => !v);
    goTo(0);
  };

  useReviewHotkeys((e) => {
    if (helpOpen) {
      if (e.key === "Escape" || e.key === "?") {
        setHelpOpen(false);
        return true;
      }
      return;
    }

    switch (machine.phase) {
      case "focus": {
        if (!current) {
          if (e.key === "r") {
            toggleReviewed();
            return true;
          }
          if (e.key === "k" || e.key === "ArrowLeft" || e.key === "z") {
            goTo(index - 1);
            return true;
          }
          return;
        }
        if (e.key === " " || e.key === "Enter") {
          dispatch({ type: "CONFIRM_CORRECT" });
          return true;
        }
        if (/^[1-9]$/.test(e.key)) {
          const alt = alternates[Number(e.key) - 1];
          if (alt) {
            dispatch({
              type: "PICK_CANDIDATE",
              cardId: alt.id,
              cardName: alt.card?.name ?? alt.name ?? alt.id,
            });
          }
          return true;
        }
        if (e.key === "/" || e.key === "s") {
          dispatch({ type: "OPEN_SEARCH" });
          return true;
        }
        if (e.key === "x") {
          dispatch({ type: "MARK_UNRESOLVABLE" });
          return true;
        }
        if (e.key === "v") {
          dispatch({ type: "MARK_WRONG_VARIANT" });
          return true;
        }
        if (e.key === "j" || e.key === "ArrowRight") {
          goTo(index + 1);
          return true;
        }
        if (e.key === "k" || e.key === "ArrowLeft" || e.key === "z") {
          goTo(index - 1);
          return true;
        }
        if (e.key === "f") {
          setRotated((r) => !r);
          return true;
        }
        if (e.key === "r") {
          toggleReviewed();
          return true;
        }
        if (e.key === "?") {
          setHelpOpen(true);
          return true;
        }
        return;
      }

      case "reason": {
        if (/^[0-9]$/.test(e.key)) {
          // 1–9 are the first nine reasons; 0 is the tenth.
          const idx = e.key === "0" ? 9 : Number(e.key) - 1;
          const reason = MISMATCH_REASONS[idx];
          if (reason) dispatch({ type: "TOGGLE_REASON", reason });
          return true;
        }
        if (e.key === "n") {
          noteInputRef.current?.focus();
          return true;
        }
        if (e.key === "Enter") {
          dispatch({ type: "SUBMIT" });
          return true;
        }
        if (e.key === "Escape") {
          dispatch({ type: "CANCEL" });
          return true;
        }
        return;
      }

      case "search": {
        if (e.key === "Escape") {
          dispatch({ type: "CANCEL" });
          return true;
        }
        return;
      }
    }
  });

  if (queue.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      <ReviewQueueStrip
        stats={stats}
        position={index}
        totalLoaded={items.length}
        onPrev={() => goTo(index - 1)}
        onNext={() => goTo(index + 1)}
        canPrev={index > 0}
        canNext={index < items.length}
        hasMore={queue.hasNextPage ?? false}
        showReviewed={showReviewed}
        onToggleReviewed={toggleReviewed}
        onRefresh={() => {
          void queue.refetch();
          goTo(0);
        }}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />

      {!current ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <IconChecklist className="size-8" />
          <p className="font-medium text-foreground">
            {items.length === 0 ? t("queue.empty") : t("queue.allDone")}
          </p>
          <p className="text-sm">
            {items.length === 0 ? t("queue.emptyHint") : t("queue.allDoneHint")}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-5">
          <ReviewFocus
            item={current}
            detail={detail}
            detailLoading={detailLoading}
            predicted={predicted}
            rotated={rotated}
          />
          <div className="border-t" />
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("focus.alternates")}
            </p>
            {detailLoading ? (
              <div className="flex items-center py-6">
                <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <CandidateRow
                alternates={alternates}
                onPick={(candidate) =>
                  dispatch({
                    type: "PICK_CANDIDATE",
                    cardId: candidate.id,
                    cardName:
                      candidate.card?.name ?? candidate.name ?? candidate.id,
                  })
                }
              />
            )}
          </div>
          {/* Every keyboard verdict as a visible button too. blur() before
              dispatching so the clicked button does not keep focus and
              swallow the next hotkey press. */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {hasPrediction && (
              <Button
                onClick={(e) => {
                  e.currentTarget.blur();
                  dispatch({ type: "CONFIRM_CORRECT" });
                }}
              >
                <IconCheck className="size-4" />
                {t("actions.confirm")}
              </Button>
            )}
            {hasPrediction && (
              <Button
                variant="outline"
                onClick={(e) => {
                  e.currentTarget.blur();
                  dispatch({ type: "MARK_WRONG_VARIANT" });
                }}
              >
                <IconRubberStamp className="size-4" />
                {t("actions.wrongVariant")}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={(e) => {
                e.currentTarget.blur();
                dispatch({ type: "OPEN_SEARCH" });
              }}
            >
              <IconSearch className="size-4" />
              {t("actions.search")}
            </Button>
            <Button
              variant="outline"
              onClick={(e) => {
                e.currentTarget.blur();
                dispatch({ type: "MARK_UNRESOLVABLE" });
              }}
            >
              <IconHelpCircle className="size-4" />
              {t("actions.unresolvable")}
            </Button>
          </div>
          <FooterHints
            hasPrediction={hasPrediction}
            altCount={alternates.length}
          />
        </div>
      )}

      {machine.phase === "reason" && machine.pending && (
        <MismatchReasonPanel
          pending={machine.pending}
          note={note}
          onNoteChange={setNote}
          onToggleReason={(reason) => dispatch({ type: "TOGGLE_REASON", reason })}
          onSubmit={() => dispatch({ type: "SUBMIT" })}
          onCancel={() => dispatch({ type: "CANCEL" })}
          noteInputRef={noteInputRef}
        />
      )}

      {machine.phase === "search" && current && (
        <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
          <div className="w-full max-w-2xl bg-card border rounded-xl shadow-lg p-5 flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">{t("search.title")}</h3>
              <span className="text-xs text-muted-foreground">
                {t("search.hint")}
              </span>
            </div>
            <CardSearchPicker
              onSelect={(card) =>
                dispatch({
                  type: "SEARCH_SELECT",
                  cardId: card.id,
                  cardName: card.name,
                })
              }
              collectionGuid={current.collectionGuid ?? undefined}
              gameKey={current.gameKey}
              initialQuery={detail?.ocr?.name ?? ""}
              resultsClassName="max-h-[55vh]"
            />
          </div>
        </div>
      )}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function FooterHints({
  hasPrediction,
  altCount,
}: {
  hasPrediction: boolean;
  altCount: number;
}) {
  const { t } = useTranslation("review");
  const hints: Array<[string, string]> = [
    ...(hasPrediction
      ? [["Space", t("shortcuts.confirm")] as [string, string]]
      : []),
    ...(altCount > 0
      ? [
          [
            altCount === 1 ? "1" : `1–${altCount}`,
            t("shortcuts.pickAlternate"),
          ] as [string, string],
        ]
      : []),
    ...(hasPrediction
      ? [["V", t("shortcuts.wrongVariant")] as [string, string]]
      : []),
    ["S", t("shortcuts.search")],
    ["X", t("shortcuts.unresolvable")],
    ["J / K", t("shortcuts.skip")],
    ["?", t("shortcuts.help")],
  ];
  return (
    <div className="mt-auto flex items-center gap-4 flex-wrap text-xs text-muted-foreground pt-2">
      {hints.map(([key, label]) => (
        <span key={key} className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-semibold">
            {key}
          </kbd>
          {label}
        </span>
      ))}
    </div>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("review");
  const rows: Array<[string, string]> = [
    ["Space / Enter", t("shortcuts.confirm")],
    ["1–6", t("shortcuts.pickAlternate")],
    ["V", t("shortcuts.wrongVariant")],
    ["S or /", t("shortcuts.search")],
    ["X", t("shortcuts.unresolvable")],
    ["J / →", t("shortcuts.skipForward")],
    ["K / ← / Z", t("shortcuts.back")],
    ["F", t("shortcuts.rotate")],
    ["R", t("shortcuts.toggleReviewed")],
    ["?", t("shortcuts.help")],
  ];
  return (
    <div
      className="absolute inset-0 z-30 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-sm bg-card border rounded-xl shadow-lg p-5 flex flex-col gap-3">
        <h3 className="font-semibold">{t("shortcuts.title")}</h3>
        <div className="flex flex-col gap-1.5">
          {rows.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <kbd className="px-1.5 py-0.5 rounded border text-[11px] font-semibold">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
