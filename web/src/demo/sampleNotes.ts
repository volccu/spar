import type { LinkPreview, Note, NoteStatus, NoteType, ReminderRepeat, UserBoard } from "../types";
import { CONFLICT_FIELDS } from "../lib/versions";
import { composeMergedBody } from "../lib/merge";
import { withNoteName } from "../lib/name";
import { trashImport, type ImportChunk, type ImportStore } from "../lib/keepImport";

/* --- the demo's sample notes ------------------------------------------------------
   One invented person's notes, for the public demo's empty Inbox ("Try it with
   sample notes") and for the screenshots in the README. Nothing here is anyone's
   real writing, and nothing comes from the owner's archive (`web/src/seed/` is
   never read here). Rewritten 2026-10-23 (owner): it should read like somebody's
   actual notes — mixed lengths, half-finished thoughts, a typo or two, lists that
   look used — and show what the app does without a tutorial, so there is no
   "Start here" note and no note explaining a gesture.

   What a visitor finds: a pile in the Inbox worth tidying, four dressed boards
   (four, so a phone's Tidy up draws every one as a button — `DIRECT_PHONE` in
   Sorter.tsx; review UX-A-04), to-do lists with some boxes ticked, an important
   note, a reminder for tomorrow and one that repeats, bare addresses living on
   Links, photographs on Inspiration and on Home, a PDF, one short code snippet,
   two merges (one a canvas worth opening, their sources in Archive), something
   else archived, and one note in the Trash.

   **This is a chunk of its own**, reached by one dynamic import from `lib/demo.ts`
   on the click, and only in a demo build — in every other build the import is
   under a `DEMO` that is literally false, and the chunk (and the pictures it
   points at) is never emitted.

   **It goes in through the Keep import's door**, `importNotes`: the same chunked
   write, the same outbox, the same file path a drop takes, and the Keep import's
   own undo (`trashImport`) — the whole set to the trash in one step, and the
   boards it made taken off the shelf once they are empty. So the notes are
   ordinary notes from the first moment: they sort, file, merge, sync and export
   exactly as ones typed in would.

   **For a script** (the Phase 6 screenshots), two ways in:
     - drive the demo build (`npm run build:demo`) and press the button — the
       offer is on the empty Inbox of a fresh browser profile, so a headless
       browser gets the set with one click and nothing else;
     - or call `buildSampleSet(now)` directly: it is pure (no DOM, no store) and
       answers the boards and notes as plain objects, for a fixture or a check.
       The files are the only part that needs a browser (`sampleFile`).
   -------------------------------------------------------------------------- */

/** What loading the set needs from the app: the Keep import's store, plus its write. */
export interface SampleStore extends ImportStore {
  importNotes: (chunk: ImportChunk) => Promise<Note[]>;
  /** The Inspiration board's id, where the pictures are filed; null puts them in the Inbox. */
  inspirationId?: () => string | null;
}

/* --- the pictures ---------------------------------------------------------------
   Real photographs, shipped with the demo (`web/src/demo/pictures/`, resized to
   1100px and re-saved without metadata) and loaded from the demo's own address
   on the click — never hotlinked. Each one is free to use with no credit owed;
   the credit is given here anyway. Checked against the Commons API, 2026-10-23.

   reading-corner.jpg  "Green living room corner (Unsplash)", Brina Blum.
                       CC0 1.0. https://commons.wikimedia.org/wiki/File:Green_living_room_corner_(Unsplash).jpg
   glazes.jpg          "Large ceramic bottles (Unsplash)", Jessica Ruscello.
                       CC0 1.0. https://commons.wikimedia.org/wiki/File:Large_ceramic_bottles_(Unsplash).jpg
   no-sign.jpg         "Vintage sign (Unsplash)", Gemma Evans.
                       CC0 1.0. https://commons.wikimedia.org/wiki/File:Vintage_sign_(Unsplash).jpg
   misty-slope.jpg     "Misty forest on a green slope", Mar Mkrtchyan (own work).
                       CC0 1.0. https://commons.wikimedia.org/wiki/File:Misty_forest_on_a_green_slope.jpg
   balcony-tomatoes.jpg "Plants on balcony D220722", Tangopaso (own work).
                       Public domain (released by the author). https://commons.wikimedia.org/wiki/File:Plants_on_balcony_D220722.jpg

   The PDF is not a download: it is written on the spot (`recipePdf`).
   -------------------------------------------------------------------------- */

const PICTURES = {
  "reading-corner": "./pictures/reading-corner.jpg",
  glazes: "./pictures/glazes.jpg",
  "no-sign": "./pictures/no-sign.jpg",
  "misty-slope": "./pictures/misty-slope.jpg",
  "balcony-tomatoes": "./pictures/balcony-tomatoes.jpg",
} as const;

/** The address each picture is served from. Spelled out per file so the build
 *  can see every `new URL(…, import.meta.url)` and emit the picture with it. */
const PICTURE_URLS: Record<keyof typeof PICTURES, () => string> = {
  "reading-corner": () => new URL("./pictures/reading-corner.jpg", import.meta.url).href,
  glazes: () => new URL("./pictures/glazes.jpg", import.meta.url).href,
  "no-sign": () => new URL("./pictures/no-sign.jpg", import.meta.url).href,
  "misty-slope": () => new URL("./pictures/misty-slope.jpg", import.meta.url).href,
  "balcony-tomatoes": () => new URL("./pictures/balcony-tomatoes.jpg", import.meta.url).href,
};

export type SampleFileKey = keyof typeof PICTURES | "pulla-pdf";

type BoardKey = "home" | "trip" | "kitchen" | "work";

// One tint, on Kitchen alone: colour is the exception in this app, and the
// demo shows it as one (review UI-06).
const BOARDS: { key: BoardKey; name: string; icon: string; color?: string }[] = [
  { key: "home", name: "Home", icon: "lucide:house" },
  { key: "trip", name: "Lisbon in May", icon: "lucide:map" },
  { key: "kitchen", name: "Kitchen", icon: "lucide:cake", color: "ember" },
  { key: "work", name: "Work", icon: "lucide:briefcase" },
];

interface Spec {
  text: string;
  /** Hours before now it was written. */
  age: number;
  board?: BoardKey;
  /** Filed on the Inspiration board (the Inbox where there is none yet). */
  inspiration?: true;
  type?: NoteType;
  priority?: 1;
  status?: NoteStatus;
  reminder?: { at: Date; repeat: ReminderRepeat | null };
  /** What the page behind each address says, so the preview needs no network. */
  links?: Omit<LinkPreview, "domain" | "image" | "fetched_at">[];
  /** The file it carries; without it the note is left out (`loadSampleNotes`). */
  file?: SampleFileKey;
}

const HOUR = 3_600_000;

/** The next time the clock reads `hour`:00 local on `weekday` (0 = Sunday), after `now`. */
function nextWeekday(now: Date, weekday: number, hour: number): Date {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  const ahead = (weekday - at.getDay() + 7) % 7;
  at.setDate(at.getDate() + ahead);
  if (at <= now) at.setDate(at.getDate() + 7);
  return at;
}

function tomorrowAt(now: Date, hour: number): Date {
  const at = new Date(now);
  at.setDate(at.getDate() + 1);
  at.setHours(hour, 0, 0, 0);
  return at;
}

/** The loose pile: what the Inbox holds, and what Tidy up is for. */
function pile(now: Date): Spec[] {
  return [
    { text: "call dentist, move the appt to after the 20th. they pick up from 8", age: 2, reminder: { at: tomorrowAt(now, 9), repeat: null } },
    {
      text: "shrink phone videos before sending them to mum (whatsapp chokes on 4k)\n```bash\nffmpeg -i in.mov -vf scale=1280:-2 -c:v libx264 -crf 26 -c:a aac out.mp4\n```\nhigher crf = smaller file. 26 looked fine",
      age: 4,
    },
    { text: "electricity bill due fri!!", age: 6, priority: 1 },
    { text: "sams bday sat 14th. present?? he keeps saying he wants a proper pepper grinder", age: 9 },
    { text: "film maria mentioned: Perfect Days (wenders)", age: 26 },
    { text: "that podcast ep about caffeine and sleep, something about half-life. find it again", age: 31 },
    { text: "bakery on the corner opens at 7 now", age: 44 },
    { text: "back tyre going flat again. valve? or just buy a new tube", age: 52 },
    {
      text: "Shelf above the desk for the plants that need light? measure first, I think that wall is hollow",
      age: 70,
    },
    { text: "move all the passwords out of the browser into the password manager. this weekend. really", age: 75 },
    { text: "pottery evening class on tuesdays, ask the price + if there's a beginners one", age: 96 },
    { text: "words I always mispell: necessary, accommodate, rhythm. and definately", age: 130 },
    { text: "printer ink 305XL", age: 170 },
    { text: "quiet coach on the morning train = carriage C", age: 200 },
    { text: "thank you card for Anna & Tom, they watered the plants for 2 weeks", age: 230 },
    { text: "miso butter mushrooms on toast. TRY", age: 260 },
    { text: "smoke alarm in the hall chirping again. 9V battery, there's one in the drawer", age: 290 },
    { text: "one buy-nothing week a month? use up the pantry, fix stuff instead. probably won't last but", age: 320 },
    { text: "ask jon what that train board game was called. ticket to something", age: 350 },
    { text: "thought on the walk home: maybe I never finish books because I start three at once and", age: 380 },
  ];
}

/** Everything that already has a home, the pictures, the addresses on Links, and the leftovers. */
function filed(now: Date): Spec[] {
  return [
    // Home
    {
      text: "[x] oat milk\n[ ] eggs\n[x] rye bread\n[ ] lemons\n[ ] coffee (the dark one)\n[x] dish soap\n[ ] cherry tomatoes\n[ ] parmesan",
      age: 7,
      board: "home",
    },
    {
      text: "water the plants. fern by the window gets extra, the cactus gets nothing",
      age: 400,
      board: "home",
      reminder: { at: nextWeekday(now, 0, 10), repeat: "weekly" },
    },
    { text: "bins: black on tuesdays, recycling every other friday", age: 600, board: "home" },
    { text: "kitchen tap washer is 1/2 inch. buy 2, the bathroom one will go next", age: 500, board: "home" },
    {
      text: "tomatoes!! 14 so far. next year pinch out the side shoots earlier, it went wild",
      age: 36,
      board: "home",
      file: "balcony-tomatoes",
    },
    {
      text: "books to read\n1. The Left Hand of Darkness\n2. Middlemarch (free on gutenberg)\n3. Piranesi\n4. A Month in the Country",
      age: 160,
      board: "home",
    },

    // Lisbon in May
    {
      text: "Packing:\n[ ] passport\n[ ] plug adapter\n[x] sunglasses\n[ ] walking shoes, the broken-in ones\n[ ] charger\n[x] light jacket for the evenings\n[ ] swimsuit just in case",
      age: 30,
      board: "trip",
      type: "todo",
    },
    {
      text: "read before we go https://en.wikipedia.org/wiki/Lisbon",
      age: 140,
      board: "trip",
      links: [
        {
          href: "https://en.wikipedia.org/wiki/Lisbon",
          title: "Lisbon",
          description: "Capital of Portugal, on the estuary of the Tagus.",
        },
      ],
    },
    { text: "nata: Manteigaria or the Belém one? everyone has an opinion. try both obviously", age: 64, board: "trip" },

    // Kitchen
    {
      text: "dal (the weeknight one)\n- 1 cup red lentils, rinsed\n- onion, 3 garlic, thumb of ginger\n- cumin, turmeric, garam masala, 1 tsp each\n- tin of tomatoes\n- 3 cups water\nonion 8 min, then garlic ginger spices 1 more. everything else in, 25 min. lemon + yoghurt at the end",
      age: 240,
      board: "kitchen",
    },
    { text: "starter: feed 1:1:1 at night, bake in the morning once it's doubled", age: 800, board: "kitchen" },
    { text: "pulla recipe from mum. she says fresh yeast, not dry", age: 120, board: "kitchen", file: "pulla-pdf" },

    // Work
    {
      text: "[ ] Q3 numbers to Anna\n[x] book a room for thursday\n[ ] reply to the supplier about the invoice\n[ ] update onboarding doc\n[x] expenses",
      age: 12,
      board: "work",
      type: "todo",
    },
    {
      text: "contract renewal due 30 Oct. ask for the 2 year price first, last time it was 12% lower",
      age: 60,
      board: "work",
      priority: 1,
    },
    {
      text: "retro thursday\ngood: shipped on time, fewer bugs since the checklist\nbad: way too many meetings in week 2\ntry: one afternoon a week with none",
      age: 90,
      board: "work",
    },
    { text: "standup: blockers first. status goes in the doc", age: 450, board: "work" },

    // Inspiration: pictures with a few words, or none worth writing.
    { text: "this corner. more plants, less stuff", age: 18, inspiration: true, file: "reading-corner" },
    { text: "glazes like these for the pottery class. the grey-green", age: 98, inspiration: true, file: "glazes" },
    { text: "hand painted №, that little underlined o", age: 150, inspiration: true, file: "no-sign" },
    { text: "lock screen", age: 310, inspiration: true, file: "misty-slope" },

    // Links: nothing but an address, so these live on Links alone.
    {
      text: "https://en.wikipedia.org/wiki/Pomodoro_Technique",
      age: 48,
      links: [
        {
          href: "https://en.wikipedia.org/wiki/Pomodoro_Technique",
          title: "Pomodoro Technique",
          description: "Working in short timed intervals, with a break after each.",
        },
      ],
    },
    {
      text: "https://en.wikipedia.org/wiki/Sourdough",
      age: 220,
      links: [
        {
          href: "https://en.wikipedia.org/wiki/Sourdough",
          title: "Sourdough",
          description: "Bread raised by a starter of wild yeast and lactic acid bacteria.",
        },
      ],
    },
    {
      text: "https://www.openstreetmap.org/",
      age: 520,
      links: [
        {
          href: "https://www.openstreetmap.org/",
          title: "OpenStreetMap",
          description: "The free map of the world, made by the people who use it.",
        },
      ],
    },

    // Put away, and thrown away.
    {
      text: "moving out checklist\n[x] meter readings\n[x] forward the post\n[x] deposit back\n[x] keys to the agent",
      age: 1400,
      board: "home",
      status: "archived",
    },
    { text: "eggs milk bread", age: 3, status: "trashed" },
  ];
}

/** Two merges: the trip's plans as an idea worth opening, and two pancake notes as one. */
const MERGES: { name: string; board: BoardKey; age: number; sources: string[] }[] = [
  {
    name: "Lisbon in May",
    board: "trip",
    age: 20,
    sources: [
      "flights: out tue 07:40, back sat evening. window seat if it's free",
      "stay in Alfama or Príncipe Real? somewhere with a tiny balcony near a tram stop",
      "eat: nata in Belém, sardines anywhere with a queue of locals, one proper seafood dinner (splurge)",
      "Sintra day trip?? train from Rossio, ~40 min. go EARLY, apparently the palace is packed by 11",
    ],
  },
  {
    name: "Pancakes",
    board: "kitchen",
    age: 300,
    sources: [
      "pancakes: 2 eggs, 250ml milk, 125g flour, pinch of salt. rest the batter 20 min",
      "thinner ones: +50ml milk and a spoon of melted butter. hot pan, hardly any oil",
    ],
  },
];

export interface SampleSet {
  boards: UserBoard[];
  notes: Note[];
  /** The file each note carries, by note id. */
  files: Map<string, SampleFileKey>;
}

function domainOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/**
 * The set as plain objects, stamped relative to `now` so the board reads "2h",
 * "3d" rather than a date from the day it was written. Pure: fresh ids on every
 * call, no DOM, no store.
 */
export function buildSampleSet(now = new Date(), positionFrom = 0, inspirationId: string | null = null): SampleSet {
  const boardIds = new Map<BoardKey, string>();
  const boards: UserBoard[] = BOARDS.map((board, i) => {
    const id = crypto.randomUUID();
    boardIds.set(board.key, id);
    return {
      id,
      name: board.name,
      position: positionFrom + i,
      icon: board.icon,
      ...(board.color ? { color: board.color } : {}),
    };
  });

  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR).toISOString();

  const note = (spec: Spec): Note => {
    const written = at(spec.age);
    return {
      id: crypto.randomUUID(),
      raw_content: spec.text,
      body: spec.text,
      source: "sample",
      created_at: written,
      updated_at: written,
      note_type: spec.type ?? null,
      board_id: spec.board ? (boardIds.get(spec.board) ?? null) : spec.inspiration ? inspirationId : null,
      status: spec.status ?? "active",
      priority: spec.priority ?? 0,
      reminder_at: spec.reminder?.at.toISOString() ?? null,
      reminder_repeat: spec.reminder?.repeat ?? null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
      ...(spec.links
        ? {
            link_previews: spec.links.map((link) => ({
              ...link,
              domain: domainOf(link.href),
              image: null,
              fetched_at: written,
            })),
          }
        : {}),
      // Every clock at the moment it was written, the way the Keep import
      // stamps an imported note: the board orders it by when it was written,
      // and the first thing done to it here stamps only what was done.
      field_updated_at: Object.fromEntries(CONFLICT_FIELDS.map((field) => [field, written])),
    };
  };

  const notes: Note[] = [];
  const files = new Map<string, SampleFileKey>();
  for (const spec of [...pile(now), ...filed(now)]) {
    const made = note(spec);
    if (spec.file) files.set(made.id, spec.file);
    notes.push(made);
  }

  // A merge, said the way `buildMerge` says it: the idea composed from its
  // sources and named with a `# ` line, the sources archived and pointing at it.
  for (const merge of MERGES) {
    const sources = merge.sources.map((text, i) =>
      note({ text, age: merge.age + 24 * (merge.sources.length - i), board: merge.board }),
    );
    const composed = composeMergedBody(sources);
    const idea = note({ text: composed, age: merge.age, board: merge.board });
    idea.source = "merge";
    idea.body = withNoteName(composed, merge.name);
    idea.created_at = sources[0].created_at;
    idea.merged_from = sources.map((s) => s.id);
    for (const source of sources) {
      source.status = "archived";
      source.merged_into = idea.id;
    }
    notes.push(idea, ...sources);
  }

  return { boards, notes, files };
}

/**
 * A one-page PDF of a recipe, written out by hand: the Files board and a
 * document's face (its first page) need a real document, and this one costs
 * nothing to ship. Plain ASCII in the PDF's own Helvetica, so every byte
 * offset in the cross-reference table is a character count.
 */
export function recipePdf(): Uint8Array {
  const lines = [
    "Pulla (cardamom buns)",
    "",
    "500 ml milk, warm",
    "50 g fresh yeast",
    "200 g sugar",
    "1 tbsp crushed cardamom",
    "1 tsp salt",
    "1 egg",
    "about 1.2 kg flour",
    "200 g soft butter",
    "",
    "Yeast into the warm milk. Sugar, cardamom, salt, egg.",
    "Flour a bit at a time, then the butter. Knead till it",
    "comes off the bowl. Rise 45 min. Braid or roll into buns,",
    "rise again 20 min. Egg wash, pearl sugar.",
    "225 C, 10-12 min for buns, 25 min for a braid.",
  ];
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 22 Tf",
    "64 760 Td",
    `(${esc(lines[0])}) Tj`,
    "/F1 13 Tf",
    "0 -36 Td",
    ...lines.slice(2).flatMap((line) => [`(${esc(line)}) Tj`, "0 -20 Td"]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/**
 * One of the set's files, from the demo's own address (the PDF made here). Null
 * where it cannot be had — no network in a test, a failed fetch — and the
 * loader then leaves that note out rather than keep words about a missing file.
 */
export async function sampleFile(which: SampleFileKey): Promise<File | null> {
  if (which === "pulla-pdf") {
    return new File([recipePdf() as BlobPart], "pulla.pdf", { type: "application/pdf" });
  }
  try {
    const response = await fetch(PICTURE_URLS[which]());
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], PICTURES[which].slice("./pictures/".length), { type: "image/jpeg" });
  } catch {
    return null;
  }
}

/**
 * Writes the sample set into the store and offers it back as one undo. Answers
 * how many notes were written.
 *
 * `file` is how a test (or a script) says what each file is; left out, they
 * are fetched from the demo's own address (`sampleFile`).
 */
export async function loadSampleNotes(
  store: SampleStore,
  { now = new Date(), file = sampleFile }: { now?: Date; file?: (key: SampleFileKey) => Promise<File | null> } = {},
): Promise<number> {
  const set = buildSampleSet(now, 0, store.inspirationId?.() ?? null);
  // The folders go on after whatever is already on the shelf, in one change —
  // the way the Keep import makes the boards its labels ask for.
  store.editBoards((list) => {
    const after = list.reduce((max, b) => Math.max(max, b.position), -1) + 1;
    return [...list, ...set.boards.map((board, i) => ({ ...board, position: after + i }))];
  });

  const loaded = new Map<string, File | null>(
    await Promise.all(
      [...set.files].map(async ([id, key]) => [id, await file(key).catch(() => null)] as const),
    ),
  );
  const chunk: ImportChunk = set.notes
    // Without its file a note is only words about something missing, so it stays out.
    .filter((note) => !set.files.has(note.id) || loaded.get(note.id))
    .map((note) => {
      const attached = loaded.get(note.id);
      return { note, files: attached ? [attached] : [] };
    });
  const made = await store.importNotes(chunk);

  const batch = { made: made.map((n) => ({ id: n.id, status: n.status })), boards: set.boards };
  store.pushUndo({
    message: `Added ${made.length} sample notes`,
    steps: [],
    run: () => void trashImport(batch, store),
  });
  return made.length;
}
