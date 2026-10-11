import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="card p-12 text-center max-w-md">
        <div className="text-lg font-semibold">Nothing here</div>
        <p className="text-sm text-muted mt-1">That page does not exist.</p>
        <Link href="/trade" className="btn btn-primary mt-4">Open the terminal</Link>
      </div>
    </div>
  );
}
