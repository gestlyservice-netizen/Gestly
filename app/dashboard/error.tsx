"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 px-6 text-center">
      <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-slate-900">
          Un problème temporaire est survenu
        </h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Nos équipes ont été prévenues automatiquement. Réessayez dans quelques instants.
        </p>
      </div>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
      >
        Réessayer
      </button>
    </div>
  );
}
