import { IconBrandDiscord } from "@tabler/icons-react";
import { Link } from "react-router-dom";

const DISCORD_URL = "https://discord.gg/fYvw5PcvGg";

export function LandingFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary font-heading text-xs font-bold text-primary-foreground">
            MV
          </span>
          <span className="font-heading text-xs font-semibold">
            Magic Vault
          </span>
        </Link>

        <nav className="flex items-center gap-5 text-xs text-muted-foreground">
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
          <Link
            to="/auth/sign-in"
            className="transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </nav>

        <div className="flex items-center gap-4">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Join the Discord"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconBrandDiscord size={18} />
          </a>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Magic Vault
          </p>
        </div>
      </div>
    </footer>
  );
}
