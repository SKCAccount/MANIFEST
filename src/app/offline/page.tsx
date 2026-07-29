export const metadata = { title: 'Offline' };

/** Cached by the service worker so a capture is still possible with no signal. */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="font-mono text-lg font-semibold">MANIFEST</h1>
      <p className="mt-4 font-medium">You are offline.</p>
      <p className="mt-2 text-sm text-ink-soft">
        Anything you captured is saved on this device and will sync automatically when the
        connection comes back. Nothing is lost.
      </p>
    </main>
  );
}
