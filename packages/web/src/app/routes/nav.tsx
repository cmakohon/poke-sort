import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getLiveSessionCounts } from "@/features/collections/api/collections";
import { useCollectionLocks } from "@/features/collections/api/use-collection-locks";
import { useCollections } from "@/features/collections/api/use-collections";
import { useOrg } from "@/hooks/use-org";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";
import {
  IconAdjustments,
  IconLayoutGrid,
  IconAlbum,
  IconCameraSpark,
  IconDatabaseCog,
  IconEyeCheck,
  IconHeartRateMonitor,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPigFilled,
  IconSettings,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

const EXPANDED_KEY = "sidebarExpanded";

interface NavItemDef {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
  badge?: boolean;
  desktopOnly?: boolean;
}

function CollapsedNavItem({ to, icon, label, end, badge }: NavItemDef) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
              buttonVariants({
                variant: isActive ? "secondary" : "ghost",
                size: "icon-lg",
              })
            }
          />
        }
      >
        <span className="relative">
          {icon}
          {badge && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-1 ring-background" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ExpandedNavItem({ to, icon, label, end, badge }: NavItemDef) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          buttonVariants({ variant: isActive ? "secondary" : "ghost" }),
          "w-full justify-start gap-2.5 px-2.5 border-0",
        )
      }
    >
      <span className="relative shrink-0">
        {icon}
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-1 ring-background" />
        )}
      </span>
      <span className="truncate text-sm">{label}</span>
    </NavLink>
  );
}

function SubItem({
  to,
  label,
  badge,
}: {
  to: string;
  label: string;
  badge?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 pl-9 pr-2 py-1 rounded-md text-xs transition-colors",
          isActive
            ? "text-foreground bg-secondary"
            : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      <span className="truncate flex-1">{label}</span>
      {badge && (
        <span className="shrink-0 size-1.5 rounded-full bg-green-500" />
      )}
    </NavLink>
  );
}

function BottomNavItem({ to, icon, label, end, badge }: NavItemDef) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-0.5 px-2 py-1 rounded-md transition-colors text-muted-foreground",
          isActive && "text-foreground",
        )
      }
    >
      <span className="relative">
        {icon}
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-1 ring-background" />
        )}
      </span>
      <span className="text-[10px] leading-none font-medium">{label}</span>
    </NavLink>
  );
}

export function AppNav() {
  const { t } = useTranslation("common");
  const { isAdmin } = useRole();
  const isMobile = useIsMobile();
  const { activeOrg } = useOrg();
  const { collections } = useCollections();
  const { locks, currentUserId } = useCollectionLocks();

  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(EXPANDED_KEY) === "true",
  );

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(EXPANDED_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      toggle();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  const { data: liveCounts } = useQuery({
    queryKey: ["live-sessions"],
    queryFn: () => getLiveSessionCounts().then((r) => r.data ?? {}),
    refetchInterval: 10000,
    enabled: !!activeOrg,
  });

  const hasLiveSessions = !!(
    currentUserId &&
    Object.entries(liveCounts ?? {}).some(
      ([guid, count]) => locks[guid]?.userId === currentUserId && count > 0,
    )
  );


  const topMonitor = [...collections]
    .sort((a, b) => {
      const aLive = !!locks[a.guid];
      const bLive = !!locks[b.guid];
      if (aLive !== bLive) return aLive ? -1 : 1;
      return 0;
    })
    .slice(0, 5);

  const navItems: NavItemDef[] = [
    {
      to: "/",
      icon: <IconCameraSpark size={20} />,
      label: t("nav.scanner"),
      end: true,
      desktopOnly: true,
    },
    {
      to: "/collections",
      icon: <IconAlbum size={20} />,
      label: t("nav.collections"),
      desktopOnly: true,
    },
    {
      to: "/sorts",
      icon: <IconLayoutGrid size={20} />,
      label: t("nav.sorts"),
      desktopOnly: true,
    },
    {
      to: "/review",
      icon: <IconEyeCheck size={20} />,
      label: t("nav.review"),
      desktopOnly: true,
    },
    {
      to: "/monitor",
      icon: <IconHeartRateMonitor size={20} />,
      label: t("nav.monitor"),
      badge: hasLiveSessions,
    },
    {
      to: "/calibrate",
      icon: <IconAdjustments size={20} />,
      label: t("nav.calibrate"),
      desktopOnly: true,
    },
    {
      to: "/settings",
      icon: <IconSettings size={20} />,
      label: t("nav.settings"),
      desktopOnly: true,
    },
    ...(isAdmin
      ? [
          {
            to: "/admin",
            icon: <IconDatabaseCog size={20} />,
            label: t("nav.admin"),
            desktopOnly: true,
          },
        ]
      : []),
  ];

  if (isMobile) {
    const mobileItems = navItems.filter((item) => !item.desktopOnly);
    return (
      <nav className="flex-none flex flex-row items-center justify-around bg-sidebar border-t px-1 py-1">
        {mobileItems.map((item) => (
          <BottomNavItem key={item.to} {...item} />
        ))}
      </nav>
    );
  }

  return (
    <aside
      className={cn(
        "py-2 flex-none flex flex-col bg-secondary/70 dark:bg-secondary/50 h-full border-r gap-2 overflow-hidden transition-[width] duration-200",
        expanded ? "w-55 items-stretch" : "w-12 items-center",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "flex items-center gap-2 cursor-default shrink-0",
            expanded ? "h-8 mx-2" : "size-8 justify-center",
          )}
        >
          <span className="bg-primary grid size-8 shrink-0 place-items-center rounded-lg text-primary-foreground">
            <IconPigFilled className="size-4" />
          </span>
          {expanded && (
            <span className="font-bold font-heading text-sm">PokeSort</span>
          )}
        </TooltipTrigger>
        <TooltipContent side="right">PokeSort</TooltipContent>
      </Tooltip>
      <Separator />
      <nav
        className={cn(
          "flex flex-col flex-1 gap-1 min-h-0 overflow-y-auto",
          expanded ? "items-stretch" : "items-center",
        )}
      >
        {navItems.map((item) => {
          if (!expanded) {
            return <CollapsedNavItem key={item.to} {...item} />;
          }

          const isMonitor = item.to === "/monitor";

          return (
            <div key={item.to} className="mx-1">
              <ExpandedNavItem {...item} />
              {isMonitor && topMonitor.length > 0 && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {topMonitor.map((c) => (
                    <SubItem
                      key={c.guid}
                      to={`/monitor/${c.guid}`}
                      label={c.name}
                      badge={!!locks[c.guid]}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <Button
        onClick={toggle}
        className={cn(expanded ? "h-8 mx-2" : "size-8")}
        variant="ghost"
        title={
          expanded
            ? t("nav.collapseSidebar")
            : t("nav.expandSidebar")
        }
      >
        {expanded ? (
          <>
            {t("nav.collapse")}
            <IconLayoutSidebarLeftCollapse size={16} />
          </>
        ) : (
          <IconLayoutSidebarLeftExpand size={16} />
        )}
      </Button>
      <Separator />
      <div
        className={cn(
          "flex gap-2",
          expanded ? "flex-row items-center px-2" : "flex-col items-center",
        )}
      >
        <ThemeToggle />
      </div>
    </aside>
  );
}
