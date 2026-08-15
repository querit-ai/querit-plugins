/**
 * Package-owned invariant companion for `dsh-querit`.
 * @module dsh-querit/invariant
 */

const PACKAGE_NAME = "dsh-querit";
/** Cordis companion plugin name. */
const name = "web-querit-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];

/**
 * No runtime invariant: the package performs stateless upstream calls and owns
 * no durable dispatch event stream to relate to a later authoritative event.
 */
const install = () => {};

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 */
const apply = (ctx: { invariants: { register(packageName: string, installer: () => void): () => void } }) =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));

export { apply, inject, name };
