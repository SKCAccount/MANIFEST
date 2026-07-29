'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuickCapture } from './quick-capture';

/**
 * Phone for capture, laptop for review — so the nav is a bottom bar on mobile
 * with the capture button in reach of a thumb, and a top bar on desktop.
 */

const LINKS = [
  { href: '/', label: 'Queue' },
  { href: '/directory', label: 'Directory' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/geography', label: 'Geography' },
  { href: '/rolodex', label: 'Rolodex' },
  { href: '/sources', label: 'Sources' },
] as const;

export function Nav({ operatorEmail }: { operatorEmail: string | null }) {
  const pathname = usePathname();
  const capture = useQuickCapture();

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
            MANIFEST
          </Link>

          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? 'page' : undefined}
                className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive(link.href)
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={capture.openSearch}
              className="btn hidden px-2.5 py-1.5 text-ink-soft sm:inline-flex"
              title="Search — Cmd+K"
            >
              Search
              <kbd className="ml-1 rounded border border-line px-1 font-mono text-[10px]">⌘K</kbd>
            </button>

            <button
              type="button"
              onClick={capture.openCapture}
              className="btn-primary hidden px-2.5 py-1.5 sm:inline-flex"
              title="Quick capture — Cmd+J"
            >
              Capture
            </button>

            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="hidden text-xs text-ink-faint hover:text-ink sm:block"
                title={operatorEmail ?? undefined}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Mobile: bottom bar plus a sticky capture button. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur sm:hidden">
        <div className="flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
          {LINKS.slice(0, 4).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={`flex-1 py-2.5 text-center text-[11px] ${
                isActive(link.href) ? 'font-semibold text-accent' : 'text-ink-soft'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={capture.openSearch}
            className="flex-1 py-2.5 text-center text-[11px] text-ink-soft"
          >
            Search
          </button>
        </div>
      </nav>

      <button
        type="button"
        onClick={capture.openCapture}
        aria-label="Quick capture"
        className="fixed right-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 h-13 w-13
                   rounded-full border border-accent bg-accent p-4 text-xl leading-none font-medium
                   text-white shadow-lg sm:hidden"
      >
        +
      </button>
    </>
  );
}
