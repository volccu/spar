import { markerOf, toggleBox, type ItemBlock } from "./blocks";

/**
 * Moving one line of a list to somewhere else in it.
 *
 * A list is the one thing in a note whose *order* is part of what it says, and
 * until now the only way to change that order was to select a line, cut it,
 * find the gap and paste — four gestures on a desktop and an ordeal on a phone.
 * Dragging is the gesture the order deserves.
 *
 * This works on lines, not on blocks. `parseBlocks` gives an item its lead and
 * tail newlines so it can be drawn as a block box, and those newlines belong to
 * the *position* rather than to the item — reordering the block texts would
 * carry them along and quietly close up or double the breaks around the list.
 * Splitting on "\n" and moving one element has neither problem.
 *
 * -- on renumbering --
 * Autoformat deliberately does not renumber: pressing Enter in the middle of a
 * numbered list leaves the numbers below it alone, because a rule that rewrites
 * text you are not currently typing is a rule that will eventually rewrite
 * something you meant. A drag is the opposite case. It is a direct instruction
 * about this list, given with the whole hand, and leaving "3." at the top of a
 * list you just reordered is not restraint — it is the app declining to do the
 * thing you asked for. So the run that was dragged, and only that run, is
 * renumbered from whatever number it already started at.
 */

/*
 * -- on renumbering after a deletion --
 * Removing an item is the other direct instruction about a list, and it leaves
 * exactly the damage a drag leaves: "1. 3. 4." for as long as the note lives.
 * But a deletion is made by typing, and typing is where renumbering has always
 * been refused — a rule that fires on a keystroke fires while you are still
 * mid-thought, and eventually rewrites something you meant.
 *
 * So `renumberLists` runs neither on a keystroke nor on display. It runs once,
 * when the editor is committed and the reader comes back — the moment the user
 * has finished and stepped away from the text. Nothing moves under the caret,
 * nothing is rewritten while it is being written, and the tidied list is the
 * first thing the reader draws.
 *
 * It is deliberately the weakest thing that could work. A run keeps the number
 * it already starts on, so a list written from 3 is still a list from 3; the
 * punctuation it was written with is kept, so "1)" is never converted to "1.";
 * a dash list is untouched; and `markerOf`'s three-digit bound means a line
 * opening "1998. Best year" is not a list and is never counted. All it ever
 * repairs is a gap or a repeat *inside* a run, which is the only thing a
 * deletion can produce. Across all 241 real notes it changes not one character
 * — `reorder.test.ts` asserts exactly that, and that assertion is the licence
 * for running it on every commit.
 */

/** The line each character offset falls on. */
export function lineAt(src: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

/** A numbered marker split into its number and the punctuation after it. */
function shapeOf(marker: string): { sep: string; gap: string } | null {
  const m = marker.match(/^\d{1,3}([.)])([ \t]+)$/);
  return m ? { sep: m[1], gap: m[2] } : null;
}

function counted(lines: string[], i: number) {
  if (i < 0 || i >= lines.length) return null;
  const m = markerOf(lines[i]);
  return m && m.numbered ? m : null;
}

/**
 * The number the run containing `i` begins on — read *before* anything moves.
 *
 * It has to be read first. Once the drag has landed, the line at the head of
 * the run may well be the line that was dragged there, and its number is the
 * one thing in the list that is now certainly wrong: reading the start from it
 * would renumber a list of three from 3, then from 5, then from 7, walking the
 * whole list up by one drag at a time.
 */
function runStart(lines: string[], i: number): number | null {
  if (!counted(lines, i)) return null;
  let first = i;
  while (counted(lines, first - 1)) first--;
  const n = Number.parseInt(counted(lines, first)!.marker, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Renumbers the run of counted items containing `at`, in place.
 *
 * The run keeps the number it already started on and the punctuation it was
 * already written with — a list that began at 3 is still a list that begins at
 * 3, and a list written "1)" is not silently converted to "1.".
 */
function renumber(lines: string[], at: number, start: number | null): void {
  if (!counted(lines, at)) return;

  let first = at;
  while (counted(lines, first - 1)) first--;
  let last = at;
  while (counted(lines, last + 1)) last++;

  const head = counted(lines, first)!;
  const shape = shapeOf(head.marker);
  const from = start ?? Number.parseInt(head.marker, 10);
  if (!shape || !Number.isFinite(from)) return;

  for (let i = first; i <= last; i++) {
    const m = counted(lines, i)!;
    lines[i] = `${m.prefix}${from + i - first}${shape.sep}${shape.gap}${m.words}`;
  }
}

/**
 * The note with the line at `from` moved to sit at `to`.
 *
 * Returns the note untouched for anything out of range or for a move that goes
 * nowhere, so a drag that ends where it started writes nothing and does not
 * wake the sync.
 */
export function moveLine(src: string, from: number, to: number): string {
  const lines = src.split("\n");
  if (from === to) return src;
  if (from < 0 || from >= lines.length) return src;
  if (to < 0 || to >= lines.length) return src;

  const start = runStart(lines, from);
  const [moved] = lines.splice(from, 1);
  // The run the line left closes up, still beginning on the number it had.
  if (start !== null) renumber(lines, counted(lines, from - 1) ? from - 1 : from, start);
  // The run the line lands in keeps *its own* start, read before the line is
  // in it (the line just before the gap, else the one just after).
  const into = runStart(lines, to - 1) ?? runStart(lines, to);
  lines.splice(to, 0, moved);
  // Only the two runs are touched, and if the list was a dash list or the line
  // was not counted at all, nothing is.
  renumber(lines, to, into ?? start);
  return lines.join("\n");
}

/**
 * A tick is a decision about one item, and the decision moves the item
 * somewhere. Done boxes sink below the ones still open, so what is left sits at
 * the top where the eye lands first — a checklist three items deep is read from
 * the top, and after the tick the top is where the open items are.
 *
 * The whole run settles in one move, not just the item that was tapped: every
 * open box keeps its place at the top in the order it was written, and every
 * done box keeps its place at the bottom in the order it was written. Nothing
 * outside the run moves, and no line is rewritten; only whole lines change
 * places.
 *
 * -- on the lines in the run that are not boxes --
 * A run is bounded by any marker, so a dash or a numbered line sitting among
 * the boxes is inside it. Those lines **do not move at all**: each one is held
 * at the index it was written on, and the boxes are dealt back into the places
 * that are left. This used to gather them into a `middle` and re-emit the run
 * as open + middle + done, which says what it does only for a line that was
 * already in the middle — a dash at the *head* of a run is the line that names
 * the list, and the first tick launched it into the middle of it:
 *
 *     – Groceries        [ ] bread
 *     [ ] milk     -->   – Groceries
 *     [ ] bread          [x] milk
 *
 * Nothing about a tick is an instruction to move anything but the box, and a
 * settle that rewrites the shape of the list around it is doing more than it
 * was asked. `tickItem` is the only caller, and both the open note and the
 * Ticker go through it, so this is one rule with two ways in.
 *
 * Returns the note untouched, by identity, when the run was already settled, so
 * a tick that moves nothing writes nothing but the box itself.
 */
export function settleChecklist(src: string, line: number): string {
  const lines = src.split("\n");
  if (line < 0 || line >= lines.length) return src;
  const head = markerOf(lines[line]);
  if (!head || head.kind !== "check") return src;

  let a = line;
  while (a > 0 && markerOf(lines[a - 1])) a--;
  let b = line;
  while (b < lines.length - 1 && markerOf(lines[b + 1])) b++;

  const run = lines.slice(a, b + 1);
  const isBox = (l: string) => markerOf(l)?.kind === "check";

  const open = run.filter((l) => isBox(l) && !markerOf(l)!.done);
  const done = run.filter((l) => isBox(l) && markerOf(l)!.done);
  // The boxes, in their settled order, dealt back into the slots the boxes
  // held — so every line that is not a box keeps the index it was written on.
  const order = [...open, ...done];
  let next = 0;
  const settled = run.map((l) => (isBox(l) ? order[next++] : l));

  if (settled.every((l, i) => l === run[i])) return src;
  return [...lines.slice(0, a), ...settled, ...lines.slice(b + 1)].join("\n");
}

/**
 * Every numbered run in the note, counting straight again from wherever it
 * already began.
 *
 * Run once on commit, never on a keystroke — see the note at the top of this
 * file. Returns the note unchanged, by identity, when there was nothing to
 * repair, so a commit that changes nothing writes nothing and does not wake
 * the sync.
 */
export function renumberLists(src: string): string {
  const lines = src.split("\n");
  // One open run per indent depth, so a sub-list is counted on its own and
  // never as part of the list above it.
  let open: { indent: number; next: number; sep: string; gap: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = counted(lines, i);
    if (!m) {
      const other = markerOf(lines[i]);
      // A deeper dash or box sits inside the item above; anything else ends
      // every run. Only the leading whitespace is depth: a box's own "- " is not.
      const indent = other ? other.prefix.match(/^[ \t]*/)![0].length : 0;
      open = other ? open.filter((r) => r.indent < indent) : [];
      continue;
    }
    const indent = m.prefix.length;
    open = open.filter((r) => r.indent <= indent);
    let run = open[open.length - 1];
    if (!run || run.indent !== indent) {
      const shape = shapeOf(m.marker);
      const from = Number.parseInt(m.marker, 10);
      if (!shape || !Number.isFinite(from)) continue;
      run = { indent, next: from, sep: shape.sep, gap: shape.gap };
      open.push(run);
    }
    lines[i] = `${m.prefix}${run.next++}${run.sep}${run.gap}${m.words}`;
  }
  const next = lines.join("\n");
  return next === src ? src : next;
}

/**
 * One tick, whole: the box changes and the run settles under it.
 *
 * Both halves or neither, and in this order — a tick that flipped the box
 * without settling the run would leave a done item sitting above three open
 * ones, and a settle computed from the text *before* the flip would sink the
 * wrong line. It is one gesture, so it is one function.
 *
 * It exists because there are now two places a box can be ticked: inside the
 * open note, and in the Ticker, which is the whole point of that mode. Two
 * call sites doing this in two steps is exactly the kind of pair that drifts —
 * one of them gains a rule and the other does not, and the note reads
 * differently depending on where it was ticked.
 */
export function tickItem(src: string, block: ItemBlock): string {
  const toggled = toggleBox(src, block);
  return settleChecklist(toggled, lineAt(src, block.markerAt));
}
