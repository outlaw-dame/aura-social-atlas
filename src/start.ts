import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // Avoid leaking OAuth codes, bearer credentials or private upstream data
    // embedded in unexpected exception messages or stack traces.
    console.error('Atlas unhandled request failure (details suppressed)');
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  // A custom Start instance does not automatically install its default CSRF
  // guard. Verify same-origin browser RPCs before any server function may
  // consume the authenticated Supabase bearer. Leave public GET routes intact.
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    errorMiddleware,
  ],
}));
