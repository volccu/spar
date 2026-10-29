# Decisions from removed plans and audits

On 2026-10-26 the finished plans and old audits left the repository; their full text is in git
history (`git log --diff-filter=D --name-only -- docs/`). This file keeps, one line each, the
decisions and rejected ideas in them, so nobody proposes them again. History, not instruction:
where it disagrees with a rulebook, the rulebook wins. Audit and review IDs the rulebooks still name
(CODE-5, SEC-6, DATA-3, FX-B-06, CH-02 and the like) come from these removed files and the reviews
behind them; find them the same way.

## Plans

- 2026-07-12 (Phase 0 plan and design): the AI layer (Claude Haiku enrichment, Voyage embeddings,
  hybrid search) was built as a throwaway proof, then removed; see `SPEC.md` §8, §12b.
- 2026-08-15 (six fixes): tagging a selection was built, then withdrawn; tags stay gone.
- 2026-08-17 (`PLAN.md`): `NoteGrid` is not extracted (27 props against a limit of 10), nor `BoardShelf`.
- 2026-08-17 (`PLAN.md`): the Phase 0 schema is not trimmed and `fts_doc` is not dropped.
- 2026-08-29 (shelf and Sorter): the shelf separates places from lenses (since widened to "the
  user's places, then the app's own boards"); the board index is never persisted.
- 2026-08 (Phase 1 shell): priority and type as colour and border, and boards as saved filters,
  were v1 and are withdrawn.
- 2026-09-17 (design-theory plan): not doing colour or ornament beyond `DESIGN.md`, any AI, streaks,
  badges or celebration, or user-scriptable "malleable software". Restraint is the point of view.
- 2026-09-24 (Tidy-up handover): a mode is reached from the menu, never a bar above the board;
  swipe-to-file stays refused.
- 2026-10-01 (`PLAN.md`): the Tauri overlay is deferred, not cancelled.
- 2026-10-08 (Inspiration plan): Inspiration is a place, not a lens, and needs no migration; its
  spec stays in `docs/superpowers/specs/`.

## Audits

- 2026-09-06 (perf): `startTransition` around `setNotes` was not taken — it breaks editing, because
  `persistBody`'s compare-and-swap stamp would lag a keystroke and drop characters.
- 2026-09-06 (perf): not taken as not worth it — re-measuring cards on each search keystroke
  (~0.5 ms), persisting the seven capability probes, `useBoards`' five transactions, `refreshPush`
  upserting each open, and dropping the per-keystroke IndexedDB write or its two unread indexes.
- 2026-09-06 (refactor): the `folders`→`canvas` and `prefs`→`boards` renames are not done (wide,
  mechanical, and the persisted names must stay); design contradictions are the owner's call.
- 2026-10-12 (code health): `restoreTo` was judged not worth it; the link-preview page-size caps are
  the owner's call.
- 2026-10-18 (UX): the owner kept only the cog/Delete fix and discarded the other ideas.
- 2026-10-24 (bug hunt): fixed in three rounds; what was left is on the Workbench.
- The 2026-08-13, 08-14, 08-18 (three), 08-29, 09-04, 09-10 and 10-10 audits were fixed or
  superseded in full; their open leftovers went to the Workbench on 2026-10-26.
