import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * A card image you can open full size.
 *
 * Both images on the detail screen are ~176px wide, which is enough to
 * recognise a card and not nearly enough to check it — whether the scan caught
 * a crease, whether the holo pattern matches the printing, whether the collector
 * number reads the way the match claims. Clicking either opens it large;
 * Escape, the close button or the backdrop all dismiss it.
 */
interface ZoomableCardImageProps {
  src: string;
  alt: string;
  /** Applied to the thumbnail frame, not to the enlarged image. */
  className?: string;
}

export function ZoomableCardImage({
  src,
  alt,
  className,
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
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Overrides the default sm:max-w-sm — the whole point is to be big.
            Sized by the image's own aspect ratio rather than a fixed width, so
            a card fills the height without ever exceeding the viewport. */}
        <DialogContent className="w-auto max-w-[calc(100vw-4rem)] sm:max-w-none p-2">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img
            src={src}
            alt={alt}
            className="max-h-[85vh] w-auto rounded-md"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
