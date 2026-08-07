import { useCollections } from "@/features/collections/api/use-collections";
import { cn } from "@/lib/utils";
import { IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

type Crumb = { label: string; to?: string };

function useBreadcrumbs(): Crumb[] {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const { collections } = useCollections();

  if (pathname === "/app") return [{ label: t("nav.scanner") }];
  if (pathname === "/app/collections")
    return [{ label: t("nav.collections") }];
  if (pathname === "/app/calibrate") return [{ label: t("nav.calibrate") }];
  if (pathname === "/app/settings") return [{ label: t("nav.settings") }];
  if (pathname === "/app/admin") return [{ label: t("nav.admin") }];
  if (pathname === "/app/monitor") return [{ label: t("nav.monitor") }];
  if (pathname.startsWith("/app/account/"))
    return [{ label: t("breadcrumb.account") }];

  const binsMatch = pathname.match(/^\/app\/collections\/([^/]+)\/bins$/);
  if (binsMatch) {
    const collection = collections.find((c) => c.guid === binsMatch[1]);
    return [
      { label: t("nav.collections"), to: "/app/collections" },
      { label: collection?.name ?? "…" },
      { label: t("breadcrumb.sortingLogic") },
    ];
  }

  const monitorMatch = pathname.match(/^\/app\/monitor\/([^/]+)$/);
  if (monitorMatch) {
    const collection = collections.find((c) => c.guid === monitorMatch[1]);
    return [
      { label: t("nav.monitor"), to: "/app/monitor" },
      { label: collection?.name ?? "…" },
    ];
  }

  return [];
}

export function AppBreadcrumb() {
  const crumbs = useBreadcrumbs();

  if (crumbs.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <IconChevronRight size={10} className="shrink-0" />}
            {crumb.to && !isLast ? (
              <Link
                to={crumb.to}
                className="hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className={cn(isLast && "text-muted-foreground")}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
