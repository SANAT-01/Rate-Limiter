"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: "3rem", textAlign: "center" }}>
      <h1>Something went wrong</h1>
      <p style={{ color: "#888", margin: "0.5rem 0 1.5rem" }}>{error.message}</p>
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}
