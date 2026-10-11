import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card p-12 text-center max-w-md mx-auto mt-10">
      <div className="text-lg font-semibold">Nothing here</div>
      <p className="text-sm text-muted mt-1">That market or trader does not exist.</p>
      <Link href="/trade" className="btn btn-primary mt-4">Back to the terminal</Link>
    </div>
  );
}
