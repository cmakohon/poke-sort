import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface CardImageDialogProps {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Applied to the enlarged image — e.g. the review screen's 180° flip. */
  imageClassName?: string;
}

/**
 * The enlarged image on its own, driven by the caller's state.
 *
 * Split out of ZoomableCardImage below for the callers whose thumbnail is
 * already a button doing something else — a nested button is invalid markup,
 * so those screens own the open state and render this directly.
 */
export function CardImageDialog({
  src,
  alt,
  open,
  onOpenChange,
  imageClassName,
}: CardImageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Overrides the default sm:max-w-sm — the whole point is to be big.
          Sized by the image's own aspect ratio rather than a fixed width, so
          a card fills the height without ever exceeding the viewport. */}
      <DialogContent className="w-auto max-w-[calc(100vw-4rem)] sm:max-w-none p-2">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <img
          src={src}
          alt={alt}
          className={cn("max-h-[85vh] w-auto rounded-md", imageClassName)}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * A card image you can open full size.
 *
 * Card images sit at 176-224px across the app, which is enough to recognise a
 * card and not nearly enough to check it — whether the scan caught a crease,
 * whether the holo pattern matches the printing, whether the collector number
 * reads the way the match claims. Clicking one opens it large; Escape, the
 * close button or the backdrop all dismiss it.
 *
 * Screens with their own keyboard shortcuts must stand down while this is open
 * — see isDialogOpen in lib/dialog-open.ts.
 */
interface ZoomableCardImageProps {
  src: string;
  alt: string;
  /** Applied to the thumbnail frame, not to the enlarged image. */
  className?: string;
  /** Applied to the thumbnail's own <img>. */
  imgClassName?: string;
  /** Applied to the enlarged image. */
  imageClassName?: string;
}

export function ZoomableCardImage({
  src,
  alt,
  className,
  imgClassName,
  imageClassName,
}: ZoomableCardImageProps) {
  const { t } = useTranslation("cards");
  const [open, setOpen] = useState(false);

  if (!src) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("cardDetailPanel.enlargeImage", { name: alt })}
        className={cn(
          "block rounded-lg overflow-hidden border cursor-zoom-in transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2",
          className,
        )}
      >
        <img
          src={src}
          alt={alt}
          className={cn("w-full h-full object-cover", imgClassName)}
        />
      </button>

      <CardImageDialog
        src={src}
        alt={alt}
        open={open}
        onOpenChange={setOpen}
        imageClassName={imageClassName}
      />
    </>
  );
}
