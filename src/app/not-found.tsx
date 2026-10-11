import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-10 text-center text-muted">
      <div className="text-lg text-fg">nothing here</div>
      <Link href="/" className="text-accent hover:underline text-xs">back to the feed</Link>
    </div>
  );
}
