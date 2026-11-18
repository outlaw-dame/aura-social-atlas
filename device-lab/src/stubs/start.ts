/** @tanstack/react-start in the Lab: server functions are already plain async functions (vite.config.ts), so
 *  useServerFn hands them back as they are. createServerFn/createMiddleware exist only for modules that reach them
 *  without going through a *.functions.ts module; their handlers never run here. */
export function useServerFn<T>(fn: T): T {
  return fn;
}

type Chain = { middleware: () => Chain; inputValidator: () => Chain; validator: () => Chain; handler: () => () => Promise<never> };
const chain: Chain = {
  middleware: () => chain,
  inputValidator: () => chain,
  validator: () => chain,
  handler: () => () => Promise.reject(new Error('Not available in the Device Lab')),
};
export const createServerFn = () => chain;
export const createMiddleware = () => ({ server: () => ({}) });
