import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { neon } from "@/lib/auth/client";
import { DISCORD_URL } from "@/lib/links";
import { cn } from "@/lib/utils";
import { IconBrandDiscord, IconPigFilled } from "@tabler/icons-react";
import { Link } from "react-router-dom";

export function LandingNav() {
  const { data, isPending } = neon.auth.useSession();
  const isSignedIn = !isPending && !!data?.user;

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <IconPigFilled className="size-4" />
          </span>
          <span className="font-heading text-sm font-semibold">
            Magic Vault
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-xs/relaxed font-medium text-muted-foreground md:flex">
          <a
            href="#features"
            className="transition-colors hover:text-foreground"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="transition-colors hover:text-foreground"
          >
            How it works
          </a>
          <a
            href="#open-source"
            className="transition-colors hover:text-foreground"
          >
            Open source
          </a>
          <Link to="/build" className="transition-colors hover:text-foreground">
            Build
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Join the Discord"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconBrandDiscord size={18} />
          </a>
          <ThemeToggle />
          {isSignedIn ? (
            <Link
              to="/app"
              className={cn(buttonVariants({ variant: "default", size: "lg" }))}
            >
              Open app
            </Link>
          ) : (
            <>
              <Link
                to="/auth/sign-in"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "lg" }),
                  "hidden sm:inline-flex",
                )}
              >
                Sign in
              </Link>
              <Link
                to="/auth/sign-up"
                className={cn(
                  buttonVariants({ variant: "default", size: "lg" }),
                )}
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
