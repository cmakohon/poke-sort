import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCatalogStatus } from "@/lib/api/admin";
import { IconDatabaseCog } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Points a fresh install at the card database.
 *
 * Without a catalog nothing can be identified, so the scanner looks broken
 * rather than unconfigured — and the importer that fixes it lives on the admin
 * page behind a game selector, which is not somewhere a new user would think to
 * look. This is the only thing that connects the two.
 *
 * Deliberately dismissible: an empty catalog is also the correct state right
 * after someone clears it on purpose, and a modal that cannot be closed would
 * make that indistinguishable from a fault.
 */
export function RequireCatalogDialog() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["catalog-status", "pokemon", "en"],
    queryFn: () => getCatalogStatus("pokemon", "en"),
    staleTime: 60_000,
  });

  // Not on /admin: that is where the importer is, so prompting there would be
  // telling someone to go where they already are.
  const isEmpty = data?.count === 0;
  const open = isEmpty && !dismissed && !location.pathname.startsWith("/admin");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setDismissed(true)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("requireCatalog.title")}</DialogTitle>
          <DialogDescription>{t("requireCatalog.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDismissed(true)}>
            {t("requireCatalog.later")}
          </Button>
          <Button
            onClick={() => {
              setDismissed(true);
              void navigate("/admin");
            }}
          >
            <IconDatabaseCog className="size-4" />
            {t("requireCatalog.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
