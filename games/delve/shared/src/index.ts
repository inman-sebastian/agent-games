// index.ts — the public API of @delve/shared, the one ruleset imported by the client, the server,
// and the tools. It re-exports the domain types, the deterministic RNG/noise helpers, the entity
// registry, the wire protocol, and the pure sim + world (engine re-exports the world queries in
// blocks). Consumers import from '@delve/shared' and never reach into individual files.
export * from './types';
export * from './fsm';
export * from './miner';
export * from './rng';
export * from './registry';
export * from './protocol';
export * from './engine'; // re-exports ./blocks (blockAt, solidAt, STRATA, ORES, …)
