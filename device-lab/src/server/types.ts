// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => Promise<unknown>;
type Result<F> = F extends (...a: never[]) => Promise<infer T> ? T : never;
/** One module's handlers: the names of its server functions, each answering with that function's result type
 *  (the input is what the app sends; the real functions validate it, the Lab trusts the app). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Impl<M> = { [K in keyof M as M[K] extends Fn ? K : never]?: (data: any) => Result<M[K]> | Promise<Result<M[K]>> };
