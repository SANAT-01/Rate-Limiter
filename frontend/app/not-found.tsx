import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: "3rem", textAlign: "center" }}>
      <h1>404 — Page not found</h1>
      <p style={{ color: "#888", margin: "0.5rem 0 1.5rem" }}>
        That route doesn&apos;t exist.
      </p>
      <Link href="/">Back to the dashboard</Link>
    </div>
  );
}
