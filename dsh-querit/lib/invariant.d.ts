/**
 * Package-owned invariant companion for `dsh-querit`.
 * @module dsh-querit/invariant
 */
/** Cordis companion plugin name. */
declare const name = "web-querit-invariant";
/** Service required before the companion can reserve package ownership. */
declare const inject: string[];
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 */
declare const apply: (ctx: {
    invariants: {
        register(packageName: string, installer: () => void): () => void;
    };
}) => Promise<() => void>;
export { apply, inject, name };
