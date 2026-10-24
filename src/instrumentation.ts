export async function register() {
  // Fail at server start, not on the first request, when configuration is unsafe.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnvironment } = await import("@/server/config/environment");
    getEnvironment();
  }
}
