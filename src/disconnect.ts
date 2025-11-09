export type CleanupFunction = () => void | Promise<void>;

let CLEANUP_FUNCTIONS: { label: string; fn: CleanupFunction }[] = [];

/**
 * Register a cleanup function to run when {@link disconnect} is called
 * @param label A descriptive name for the function for logging purposes
 * @param fn The cleanup function
 */
export function registerCleanupFunction(label: string, fn: CleanupFunction) {
  if (typeof fn !== 'function') {
    throw new Error(`Expected fn to be a function, received ${typeof fn}`);
  }
  CLEANUP_FUNCTIONS.push({ label, fn });
}

/** Run all registered cleanup functions */
export async function disconnect() {
  // Make a local copy and reset the main list in case this gets called more than once.
  const cleanupFunctions = [...CLEANUP_FUNCTIONS];
  CLEANUP_FUNCTIONS = [];

  await Promise.all(
    cleanupFunctions.map(async ({ fn, label }) => {
      try {
        await fn();
      } catch (error: any) {
        console.error(`Fatal error in '${label}' cleanup function: ${error?.message}`);
      }
    })
  );
}
