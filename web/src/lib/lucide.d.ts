/**
 * Types for the three Lucide files the board-look picker reaches past the
 * packages' front doors (`lib/lucideSet.ts`, `lib/markSearch.ts`).
 *
 * **Why deep paths at all.** `lucide-react`'s index re-exports 1,854 icon
 * modules, and the bundler reads every one of them before it can tree-shake
 * them away — the build's module count went from three figures to four for one
 * component. The picker needs the drawings as *data*, which `lucide-static`
 * ships as one JSON file, and needs only the renderer from `lucide-react`.
 *
 * **Why declared here rather than left to `resolveJsonModule`.** The compiler
 * would otherwise infer a literal type for 420 kB of path data on every
 * typecheck. An ambient declaration for a bare specifier is consulted before
 * `node_modules`, so these shapes are what TypeScript sees, and they are the
 * shapes the files have (`lib/boardLook.test.ts` reads the real files).
 */

declare module "lucide-static/icon-nodes.json" {
  /** Every Lucide drawing by its kebab-case name: `[element, attributes][]`. */
  const nodes: Record<string, [string, Record<string, string>][]>;
  export default nodes;
}

declare module "lucide-static/tags.json" {
  /** Every Lucide icon's search words, by its kebab-case name. */
  const tags: Record<string, string[]>;
  export default tags;
}

declare module "lucide-react/dist/esm/Icon.mjs" {
  /** Lucide's one renderer: draws whatever `iconNode` it is handed. */
  const Icon: typeof import("lucide-react").Icon;
  export default Icon;
}
