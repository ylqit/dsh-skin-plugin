/** Package-owned invariant companion for the inert synchronized-skin boundary. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@ylq77147/dsh-skin-plugin'

/** Cordis companion plugin name. */
export const name = 'dsh-skin-plugin-invariant'
/** Service required before package ownership is registered. */
export const inject = ['invariants']

/**
 * No runtime invariant: archive, catalog, asset, activation, and HTTP trust
 * relations are validated at their untrusted or durable boundaries, while
 * route and Theme Boot lifecycle ownership is enforced by their registries.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
