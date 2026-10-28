import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import AdjustmentsHorizontalIcon from "@heroicons/react/24/outline/AdjustmentsHorizontalIcon";
import ChevronLeftIcon from "@heroicons/react/24/outline/ChevronLeftIcon";
import CommandLineIcon from "@heroicons/react/24/outline/CommandLineIcon";
import DevicePhoneMobileIcon from "@heroicons/react/24/outline/DevicePhoneMobileIcon";
import DocumentTextIcon from "@heroicons/react/24/outline/DocumentTextIcon";
import MagnifyingGlassIcon from "@heroicons/react/24/outline/MagnifyingGlassIcon";
import UserCircleIcon from "@heroicons/react/24/outline/UserCircleIcon";
import type { Canvas, Note, UserBoard } from "../types";
import { HIDABLE, type BuiltInKey } from "../lib/boards";
import { buildInfo } from "../lib/build";
import { useIsPhone } from "../lib/breakpoint";
import { DEMO, removeSamples } from "../lib/demo";
import { missingFilesLine, planArchive, writeArchive, type ArchiveResult } from "../lib/exportArchive";
import { appBadgeOn, canBadge, installed, setAppBadgeOn } from "../lib/appBadge";
import { canVibrate, hapticsOn, setHapticsOn } from "../lib/hapticsSwitch";
import { useHasKeyboard } from "../lib/hotkeys";
import { askToKeep, type Kept } from "../lib/keepStorage";
import { bookmarklet } from "../lib/launch";
import { useSetting, writeSetting, type SettingName, type SettingValue } from "../lib/settings";
import { chordLabel, chordWords, SHORTCUTS } from "../lib/shortcuts";
import type { Gesture } from "../lib/speed";
import { saveBlob } from "../lib/saveFile";
import { PROMISE_MS, speeds } from "../lib/speedReport";
import { TRASH_DAYS } from "../lib/trash";
import { useModeLayer } from "../lib/useModeLayer";
import { exportBytes } from "../store/attachments";
import { RUNTIME_CONFIG } from "../store/backend/config";
import type { PushState } from "../store/push";
import { locationAnswer } from "../store/weather";
import { KeyCaps } from "./Hotkey";
import { IconAbout, IconClear, IconDelete, IconDownload, IconImport, IconReminder, mark } from "./Icons";

/* --- Settings ---------------------------------------------------------------
   Every switch the app has, in one place (2026-10-11, owner approved). The
   About page had become the place a preference went for want of another, and
   DESIGN.md §1 already said it was the wrong home: it is a colophon. So the
   switches, the way in and out of the notes, the account and the facts about
   this device all moved here, and About went back to saying what spår is.

   The shape is a settings screen's, the owner's reference: sections down the
   left with a search over them, the chosen section's rows on the right, each
   row its words on the left and its control on the right. On a phone the
   sections are a list a tap goes into, with a way back. Drawn in the app's own
   grammar throughout — chrome raises, nothing is coloured, the words are the
   reading face and the states are the machine's.

   Every change is made the moment it is pressed. There is no Save: a setting
   is a fact about this device, never a draft (`lib/settings.ts`).

   A layer of About's kind (`useModeLayer`), lazy with everything it reads, so
   the export, the speed report and these marks stay off the first paint. The
   marks only this screen draws are imported here rather than in `Icons.tsx`
   for the same reason: that module rides on the first paint.
   -------------------------------------------------------------------------- */

export type SettingsSection =
  "general" | "notes" | "reminders" | "keys" | "data" | "device" | "account";

interface Props {
  notes: Note[];
  folders: UserBoard[];
  canvases: Canvas[];
  /** The notes also go to a server. */
  synced: boolean;
  onClose: () => void;
  /** Filled with the phone's Back for a section: true when it stepped back. */
  backRef?: { current: (() => boolean) | null };
  restoreTo: RefObject<HTMLButtonElement | null>;
  at?: SettingsSection;
  /** Whether reminders ring here, and the two ways to change that. */
  pushStatus: PushState;
  onEnableRing: () => void;
  onDisableRing: () => void;
  trashCount: number;
  onOpenTrash: () => void;
  /** The app's own boards taken off the shelf (synced with its order), and the switch. */
  shelfHidden?: readonly string[];
  onHideBoard?: (key: BuiltInKey, hide: boolean) => void;
  /** Inspiration exists on this account yet (it is made after the first sync). */
  hasInspiration?: boolean;
  onImportKeep: () => void;
  onImportSpar?: () => void;
  onAbout: () => void;
  /** Sync is set up in this build at all; without it there is no account. */
  syncConfigured: boolean;
  signedIn: boolean;
  /** Sign out, or sign in to sync — the menu's old row, exactly. */
  onAccount: () => void;
  /** On a spår server only (see About's old section). */
  onDeleteAccount?: (password: string) => Promise<string | null>;
}

type Export =
  | { at: "idle" }
  | { at: "working"; done: number; total: number }
  | { at: "done"; result: ArchiveResult }
  | { at: "failed" };

const GESTURE_WORD: Record<Gesture, string> = {
  capture: "Capture",
  open: "Open",
  type: "Type",
  find: "Find",
};

function builtOn(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* --- the controls ------------------------------------------------------------ */

interface Choice<V extends string> {
  value: V;
  label: string;
}

/**
 * A few answers side by side, the one in force raised (DESIGN.md §5: chrome
 * raises). Each is a toggle with one fixed name, so `aria-pressed` carries the
 * state, the rule every toggle in the app keeps.
 */
function Segments<V extends string>({
  name,
  choices,
  value,
  onChange,
}: {
  name: string;
  choices: Choice<V>[];
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <div className="settings-seg" role="group" aria-label={name}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={value === c.value}
          onClick={() => onChange(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** A segmented control bound straight to one of this device's settings. */
function SettingSegments<N extends SettingName>({
  name,
  setting,
  choices,
}: {
  name: string;
  setting: N;
  choices: Choice<SettingValue<N>>[];
}) {
  const value = useSetting(setting);
  return (
    <Segments
      name={name}
      choices={choices}
      value={value}
      onChange={(v) => writeSetting(setting, v)}
    />
  );
}

const NONE_HIDDEN: readonly string[] = [];

const SHOWN_HIDDEN: Choice<"shown" | "hidden">[] = [
  { value: "shown", label: "Shown" },
  { value: "hidden", label: "Hidden" },
];

const ON_OFF: Choice<"on" | "off">[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/** One row: its words on the left, its control on the right. */
interface Row {
  id: string;
  label: string;
  /** A line under the label, in the reading face's quiet voice (`.advice`). */
  advice?: string;
  control?: ReactNode;
  /** A row that is a passage rather than a label and a control (the keys). */
  whole?: ReactNode;
}

interface Block {
  heading: string;
  rows: Row[];
  /** Drawn closed under its heading, opened by a tap on it (review WD-04). */
  fold?: boolean;
}

interface Section {
  id: SettingsSection;
  /** Named above its first section; "" for the first group, which the dialog's own title already names. */
  group: string;
  name: string;
  glyph: ReactNode;
  blocks: Block[];
}

function RowView({ row }: { row: Row }) {
  if (row.whole) return <div className="settings-row settings-row-whole">{row.whole}</div>;
  return (
    <div className="settings-row">
      <div className="settings-row-words">
        <p className="settings-label">{row.label}</p>
        {row.advice && <p className="settings-advice advice">{row.advice}</p>}
      </div>
      {row.control && <div className="settings-control">{row.control}</div>}
    </div>
  );
}

/* --- the account's closing, moved from About whole ------------------------- */

function CloseAccount({ onDelete }: { onDelete: (password: string) => Promise<string | null> }) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || working) return;
    setWorking(true);
    setError(null);
    const said = await onDelete(password);
    if (!alive.current) return;
    setWorking(false);
    if (said) setError(said);
  }

  if (!asking) {
    return (
      <button type="button" className="btn mono settings-btn" onClick={() => setAsking(true)}>
        Delete the account
      </button>
    );
  }
  return (
    <form className="settings-close-account" onSubmit={(e) => void submit(e)}>
      <input
        className="signin-input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Your password"
        aria-label="Your password"
        autoComplete="current-password"
        required
        autoFocus
      />
      <button type="submit" className="btn mono settings-btn" disabled={working}>
        {working ? "Deleting" : "Delete for good"}
      </button>
      <button
        type="button"
        className="btn mono settings-btn"
        // Once the deletion is under way it cannot be called back, so Cancel
        // must not look as if it had.
        disabled={working}
        onClick={() => {
          setAsking(false);
          setPassword("");
          setError(null);
        }}
      >
        Cancel
      </button>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/* --- the screen -------------------------------------------------------------- */

export function Settings({
  notes,
  folders,
  canvases,
  synced,
  onClose,
  backRef,
  restoreTo,
  at,
  pushStatus,
  onEnableRing,
  onDisableRing,
  trashCount,
  onOpenTrash,
  shelfHidden = NONE_HIDDEN,
  onHideBoard,
  hasInspiration = false,
  onImportKeep,
  onImportSpar,
  onAbout,
  syncConfigured,
  signedIn,
  onAccount,
  onDeleteAccount,
}: Props) {
  const { layerRef, close, trapTab } = useModeLayer({
    count: 1,
    origin: null,
    onClose,
    restoreTo,
  });
  const phone = useIsPhone();
  const keyboard = useHasKeyboard();
  // On a phone the list of sections is a page of its own, and a tap goes
  // into one; `null` is that list. A desktop always shows a section.
  const [open, setOpen] = useState<SettingsSection | null>(at ?? (phone ? null : "general"));
  const [query, setQuery] = useState("");
  // The phone's Back steps out of a section as Escape and the back mark do,
  // rather than closing Settings from inside one (bughunt 2026-10-15).
  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (!phone || !open) return false;
      setOpen(null);
      return true;
    };
    return () => {
      backRef.current = null;
    };
  }, [backRef, phone, open]);
  const [exporting, setExporting] = useState<Export>({ at: "idle" });
  const [measured, setMeasured] = useState(speeds);
  const [pulse, setPulse] = useState(hapticsOn);
  const [badge, setBadge] = useState(appBadgeOn);
  const [badgeable] = useState(() => canBadge() && installed());
  // Whether this site may know where the device is, for the weather row's words.
  const [geo, setGeo] = useState<PermissionState | "none">("prompt");
  useEffect(() => {
    let live = true;
    void locationAnswer().then((answer) => live && setGeo(answer));
    return () => {
      live = false;
    };
  }, []);
  // Firefox on Android installs the app without a place in the share sheet
  // or a launcher shortcut; only Chrome's install has them (review PS-01).
  const [firefoxApp] = useState(
    () => installed() && /Android/.test(navigator.userAgent) && /Firefox\//.test(navigator.userAgent),
  );
  const [kept, setKept] = useState<Kept>(null);
  const alive = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const build = buildInfo();

  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => setMeasured(speeds()), 1000);
    void askToKeep().then((answer) => {
      if (alive.current) setKept(answer);
    });
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, []);

  // A section chosen starts at its top, and on a phone the focus goes with
  // it so the reader is not left on a list that has gone.
  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [open]);

  async function takeOut() {
    if (exporting.at === "working") return;
    try {
      const plan = planArchive({ notes, folders, canvases });
      setExporting({ at: "working", done: 0, total: plan.fileCount });
      const result = await writeArchive(plan, exportBytes, (done, total) => {
        if (alive.current) setExporting({ at: "working", done, total });
      });
      saveBlob(result.blob, result.fileName);
      if (alive.current) setExporting({ at: "done", result });
    } catch (err) {
      // The raw text goes to the console, never the screen (web/CLAUDE.md).
      console.error("[spår] the export failed", err);
      if (!alive.current) return;
      setExporting({ at: "failed" });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") {
      trapTab(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // A search clears before the screen closes; on a phone a section steps
      // back to the list first, as its back mark does.
      if (query) setQuery("");
      else if (phone && open) setOpen(null);
      else close();
    }
  }

  const theme = useSetting("theme");
  const motion = useSetting("motion");
  const trashed = notes.filter((n) => n.status === "trashed").length;
  const glyph = (Glyph: Parameters<typeof mark>[0]) => mark(Glyph, "inline");

  const exportStatus =
    exporting.at === "working" && exporting.total > 0
      ? `File ${exporting.done} of ${exporting.total}`
      : exporting.at === "done"
        ? `Saved ${exporting.result.fileName}: ${exporting.result.noteCount} ${exporting.result.noteCount === 1 ? "note" : "notes"}, ${exporting.result.fileCount} ${exporting.result.fileCount === 1 ? "file" : "files"}.` +
          (exporting.result.missing.length > 0 ? ` ${missingFilesLine(exporting.result.missing.length)}` : "")
        : "";

  const sections: Section[] = [
    {
      id: "general",
      group: "",
      name: "General",
      glyph: glyph(AdjustmentsHorizontalIcon),
      blocks: [
        {
          heading: "Appearance",
          rows: [
            {
              id: "theme",
              label: "Theme",
              advice: theme === "system" ? "System follows this device." : undefined,
              control: (
                <SettingSegments
                  name="Theme"
                  setting="theme"
                  choices={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              ),
            },
            // Only where it governs something: a desktop's strip stands at the
            // top whatever this says.
            ...(phone
              ? [
                  {
                    id: "boardRow",
                    label: "Board row",
                    advice: "Bottom is easier to reach with your thumb.",
                    control: (
                      <SettingSegments
                        name="Board row"
                        setting="boardRow"
                        choices={[
                          { value: "top", label: "Top" },
                          { value: "bottom", label: "Bottom" },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
            {
              id: "motion",
              label: "Motion",
              // Says what the choice does, not what the other one would: the
              // same rule as the Theme line above.
              advice:
                motion === "reduced"
                  ? "Sliding and fading are off."
                  : "Sliding and fading follow this device.",
              control: (
                <SettingSegments
                  name="Motion"
                  setting="motion"
                  choices={[
                    { value: "system", label: "System" },
                    { value: "reduced", label: "Reduced" },
                  ]}
                />
              ),
            },
          ],
        },
        {
          heading: "Feel",
          rows: [
            ...(canVibrate()
              ? [
                  {
                    id: "haptics",
                    label: "Vibrate",
                    advice: "A short buzz when a note is saved or a box is ticked.",
                    control: (
                      <Segments
                        name="Vibrate"
                        choices={ON_OFF}
                        value={pulse ? "on" : "off"}
                        onChange={(v) => {
                          setHapticsOn(v === "on");
                          setPulse(v === "on");
                        }}
                      />
                    ),
                  },
                ]
              : []),
            // The creature's weather (`lib/useWeatherLine.ts`). Not in the demo,
            // which sends nothing anywhere.
            ...(DEMO
              ? []
              : [
                  {
                    id: "weather",
                    label: "Weather from the robot",
                    advice:
                      geo === "denied"
                        ? "Location is blocked for this site, so allow it in the browser to hear the weather."
                        : "Now and then the robot says the weather and when a sunny day is coming, from Open-Meteo and this device's rough location.",
                    control: <SettingSegments name="Weather from the robot" setting="weather" choices={ON_OFF} />,
                  },
                ]),
            // The pen on a canvas (`lib/shapeSnap.ts`): Undo always gives the rough line back.
            {
              id: "tidyShapes",
              label: "Tidy shapes when drawing",
              advice: "Hold the pen still at the end of a rough line, circle or box on an idea to make it clean, and Undo gives back what you drew.",
              control: <SettingSegments name="Tidy shapes when drawing" setting="tidyShapes" choices={ON_OFF} />,
            },
            // Offered only where it can be seen: an installed app in a browser
            // that badges (`lib/appBadge.ts`).
            ...(badgeable
              ? [
                  {
                    id: "badge",
                    label: "Inbox count on the app icon",
                    control: (
                      <Segments
                        name="Inbox count on the app icon"
                        choices={ON_OFF}
                        value={badge ? "on" : "off"}
                        onChange={(v) => {
                          setAppBadgeOn(v === "on");
                          setBadge(v === "on");
                        }}
                      />
                    ),
                  },
                ]
              : []),
          ],
        },
        ...(onHideBoard ? [{
          // The shelf's own boards, each shown or hidden. Unlike every switch
          // above, this one is the account's: it travels with the shelf's order.
          heading: "Boards",
          rows: [
            {
              id: "board-inbox",
              label: "Inbox",
              advice: "Always shown, because the app opens on it. Hiding a board moves nothing, and search still finds its notes.",
            },
            ...HIDABLE.map(({ key: board, name }) => ({ board, name }))
              .filter(({ board }) => board !== "inspiration" || hasInspiration)
              .map(({ board, name }) => ({
              id: `board-${board}`,
              label: name,
              advice: board === "trash" ? "When hidden, it is still in the menu." : undefined,
              control: (
                <Segments
                  name={name}
                  choices={SHOWN_HIDDEN}
                  value={shelfHidden.includes(board) ? "hidden" : "shown"}
                  onChange={(v) => onHideBoard(board, v === "hidden")}
                />
              ),
            })),
          ],
        }] : []),
      ],
    },
    {
      id: "notes",
      group: "",
      name: "Notes",
      glyph: glyph(DocumentTextIcon),
      blocks: [
        {
          heading: "Links",
          rows: [
            {
              id: "previews",
              label: "Link previews",
              advice: DEMO
                ? "The demo has no server, so a link shows only its address and your words."
                : "On gets a page's title and picture through your server, and Off sends nothing.",
              control: (
                <SettingSegments
                  name="Link previews"
                  setting="previews"
                  choices={[
                    { value: "fetch", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                />
              ),
            },
          ],
        },
        {
          heading: "Trash",
          rows: [
            {
              id: "trash",
              label: trashCount === 1 ? "1 note in the trash" : `${trashCount} notes in the trash`,
              advice: `A deleted note can be put back for ${TRASH_DAYS} days, then it is gone for good${synced ? ", here and on the server" : ""}.`,
              control: (
                <button type="button" className="btn mono settings-btn" onClick={onOpenTrash}>
                  Open trash
                </button>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "reminders",
      group: "",
      name: "Reminders",
      glyph: <IconReminder tier="inline" />,
      blocks: [
        {
          heading: "Reminders",
          rows: [
            {
              id: "ring",
              label: "Ring on this device",
              advice:
                pushStatus === "denied"
                  ? "Notifications are blocked for this site; allow them in your browser's settings."
                  : pushStatus === "unavailable"
                    ? DEMO
                      ? "Ringing needs a server, and the demo has none."
                      : "This browser cannot notify."
                    : "Each device has its own switch.",
              control:
                pushStatus === "denied" || pushStatus === "unavailable" ? undefined : (
                  <Segments
                    name="Ring on this device"
                    choices={ON_OFF}
                    value={pushStatus === "on" ? "on" : "off"}
                    onChange={(v) => (v === "on" ? onEnableRing() : onDisableRing())}
                  />
                ),
            },
          ],
        },
      ],
    },
    ...(keyboard
      ? [
          {
            id: "keys" as const,
            group: "",
            name: "Keyboard",
            glyph: glyph(CommandLineIcon),
            blocks: [
              ...SHORTCUTS.map((group) => ({
                heading: group.where,
                rows: group.shortcuts.map((shortcut) => ({
                  id: `${group.where}:${shortcut.does}`,
                  label: shortcut.does,
                  control: (
                    <span className="settings-keys">
                      {shortcut.keys.map((chord, i) => (
                        <Fragment key={chordLabel(chord)}>
                          <KeyCaps label={chordLabel(chord)} />
                          <span className="offscreen">{`${i > 0 ? " or " : ""}${chordWords(chord)}`}</span>
                        </Fragment>
                      ))}
                    </span>
                  ),
                })),
              })),
              {
                heading: "Saving pages",
                rows: [
                  {
                    id: "bookmarklet",
                    label: "Save a page from your browser",
                    advice:
                      "Drag it to your bookmarks bar, then press it on any page to save the page and any words you selected.",
                    control: (
                      <a
                        className="btn mono settings-btn settings-bookmark"
                        draggable
                        onClick={(e) => e.preventDefault()}
                        // A `javascript:` address is set on the element, not
                        // through React, which refuses to render one.
                        ref={(el) => el?.setAttribute("href", bookmarklet(window.location.origin))}
                      >
                        Save to spår
                      </a>
                    ),
                  },
                ],
              },
            ],
          },
        ]
      : []),
    {
      id: "data",
      group: "Your notes",
      name: "Import and export",
      glyph: <IconImport />,
      blocks: [
        {
          heading: "Bring notes in",
          rows: [
            {
              id: "keep",
              label: "Import from Google Keep",
              advice: "Bring in a Google Takeout download, and choose which labels become boards.",
              control: (
                <button type="button" className="btn mono settings-btn" onClick={onImportKeep}>
                  <IconImport />
                  <span>Import</span>
                </button>
              ),
            },
            // The demo's visitor, with the sample notes in and their own to
            // bring: one row sends only the samples to the trash, offered back
            // by the undo the board shows once this closes (review UX-08).
            ...(DEMO && notes.some((n) => n.source === "sample" && n.status !== "trashed")
              ? [
                  {
                    id: "samples",
                    label: "Remove the sample notes",
                    advice: "Only the sample notes go to the trash. Yours stay, and Undo brings them back.",
                    control: (
                      <button
                        type="button"
                        className="btn mono settings-btn"
                        onClick={() => {
                          void removeSamples().then(onClose);
                        }}
                      >
                        <IconDelete />
                        <span>Remove</span>
                      </button>
                    ),
                  },
                ]
              : []),
            ...(onImportSpar
              ? [
                  {
                    id: "spar",
                    label: "Import a spår download",
                    advice: "Put back the notes from an earlier download, skipping any already here.",
                    control: (
                      <button
                        type="button"
                        className="btn mono settings-btn"
                        onClick={onImportSpar}
                      >
                        <IconImport />
                        <span>Choose</span>
                      </button>
                    ),
                  },
                ]
              : []),
          ],
        },
        {
          heading: "Take everything out",
          rows: [
            {
              id: "export",
              label: "Download everything",
              advice: "Every note as a plain text file, in one zip that opens without spår.",
              control: (
                <button
                  type="button"
                  className="btn mono settings-btn"
                  onClick={() => void takeOut()}
                  disabled={exporting.at === "working"}
                >
                  <IconDownload />
                  <span>{exporting.at === "working" ? "Packing" : "Download"}</span>
                </button>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "device",
      group: "Your notes",
      name: "This device",
      glyph: glyph(DevicePhoneMobileIcon),
      blocks: [
        {
          heading: "This device",
          rows: [
            ...(firefoxApp
              ? [
                  {
                    id: "firefox",
                    label: "To share pages and pictures into spår, install it from Chrome.",
                    whole: (
                      <p className="settings-advice advice">
                        To share pages and pictures into spår, install it from Chrome.
                      </p>
                    ),
                  },
                ]
              : []),
            {
              id: "notes-here",
              label: "Notes",
              control: (
                <span className="settings-data mono">
                  {notes.length}
                  {trashed > 0 ? ` · ${trashed} in the trash` : ""}
                </span>
              ),
            },
            ...(kept !== null
              ? [
                  {
                    id: "kept",
                    label: "Storage",
                    advice: kept
                      ? undefined
                      : "The browser may clear the notes when space runs low, less often once the app is installed.",
                    control: (
                      <span className="settings-data mono">
                        {kept ? "kept until you clear it" : "may be cleared"}
                      </span>
                    ),
                  },
                ]
              : []),
          ],
        },
        {
          heading: "Build and speed",
          fold: true,
          rows: [
            {
              id: "build",
              label: "Build",
              control: (
                <span className="settings-data mono">
                  {build.commit}
                  {build.built ? ` · ${builtOn(build.built)}` : ""}
                </span>
              ),
            },
            {
              id: "speed-note",
              label: `How fast each one reached the screen this session, aiming for under ${PROMISE_MS} ms.`,
              whole: (
                <p className="settings-advice advice">
                  How fast each one reached the screen this session, aiming for under {PROMISE_MS} ms.
                </p>
              ),
            },
            ...measured.map((s) => ({
              id: `speed-${s.gesture}`,
              label: GESTURE_WORD[s.gesture],
              control: (
                <span
                  className="settings-data mono"
                  data-over={s.median !== null && s.median > PROMISE_MS ? "true" : undefined}
                >
                  {s.median === null
                    ? "not yet"
                    : `${s.median} ms${s.median > PROMISE_MS ? " · over" : ""}`}
                </span>
              ),
            })),
          ],
        },
      ],
    },
    ...(syncConfigured
      ? [
          {
            id: "account" as const,
            group: "Account",
            name: "Account",
            glyph: glyph(UserCircleIcon),
            blocks: [
              {
                heading: "Account",
                rows: [
                  {
                    id: "sign",
                    label: signedIn ? "Sign out" : "Sign in to sync",
                    advice: signedIn
                      ? "You choose whether this device keeps its notes."
                      : "Your notes are on this device only until you sign in.",
                    control: (
                      <button type="button" className="btn mono settings-btn" onClick={onAccount}>
                        {signedIn ? "Sign out" : "Sign in"}
                      </button>
                    ),
                  },
                  ...(RUNTIME_CONFIG && onDeleteAccount
                    ? [
                        {
                          id: "close-account",
                          label: "Close the account",
                          advice:
                            "Deletes your account and everything this server keeps for you, for good, with no undo. Download everything first.",
                          control: <CloseAccount onDelete={onDeleteAccount} />,
                        },
                      ]
                    : []),
                ],
              },
            ],
          },
        ]
      : []),
  ];

  const term = query.trim().toLowerCase();
  const hits = term
    ? sections.flatMap((s) =>
        s.blocks
          .map((b) => ({
            where: `${s.name} · ${b.heading}`,
            rows: b.rows.filter((r) =>
              `${r.label} ${r.advice ?? ""} ${b.heading} ${s.name}`.toLowerCase().includes(term),
            ),
          }))
          .filter((b) => b.rows.length > 0),
      )
    : [];
  const shown = sections.find((s) => s.id === open) ?? null;
  // A phone shows the list or one section. A search is typed on the list,
  // so there the list's rows give way to the results under the field.
  const inside = !term && shown !== null;

  let lastGroup = "";
  return (
    <div
      ref={layerRef}
      className="about settings"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-inside={inside ? "true" : undefined}
      data-searching={term ? "true" : undefined}
    >
      <div className="settings-head">
        {phone && inside ? (
          <button
            type="button"
            className="settings-back"
            onClick={() => {
              setQuery("");
              setOpen(null);
            }}
          >
            {glyph(ChevronLeftIcon)}
            <span>Settings</span>
          </button>
        ) : (
          <h2 className="settings-title">Settings</h2>
        )}
        <button
          type="button"
          className="about-close"
          aria-label="Close"
          title="Close"
          onClick={close}
        >
          <IconClear />
        </button>
      </div>

      <div className="settings-frame">
        <nav className="settings-nav" aria-label="Sections">
          <label className="settings-search">
            {glyph(MagnifyingGlassIcon)}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              autoComplete="off"
            />
          </label>
          {sections.map((s) => {
            const heading = s.group !== lastGroup ? s.group : null;
            lastGroup = s.group;
            return (
              <Fragment key={s.id}>
                {heading && <p className="settings-group">{heading}</p>}
                <button
                  type="button"
                  className="settings-section"
                  aria-current={!term && open === s.id ? "true" : undefined}
                  onClick={() => {
                    setQuery("");
                    setOpen(s.id);
                  }}
                >
                  {s.glyph}
                  <span>{s.name}</span>
                </button>
              </Fragment>
            );
          })}
          <button type="button" className="settings-section" onClick={onAbout}>
            <IconAbout />
            <span>About spår</span>
          </button>
        </nav>

        <div className="settings-content" ref={contentRef}>
          {term ? (
            hits.length > 0 ? (
              hits.map((b) => (
                <section className="settings-block" key={b.where}>
                  <h3 className="settings-h">{b.where}</h3>
                  {b.rows.map((r) => (
                    <RowView key={r.id} row={r} />
                  ))}
                </section>
              ))
            ) : (
              <p className="settings-none advice">
                No setting matches &ldquo;{query.trim()}&rdquo;.
              </p>
            )
          ) : (
            shown?.blocks
              .filter((b) => b.rows.length > 0)
              .map((b) =>
                b.fold ? (
                  <details className="settings-block settings-fold" key={b.heading}>
                    <summary className="settings-h">{b.heading}</summary>
                    {b.rows.map((r) => (
                      <RowView key={r.id} row={r} />
                    ))}
                  </details>
                ) : (
                <section className="settings-block" key={b.heading}>
                  <h3 className="settings-h">{b.heading}</h3>
                  {b.rows.map((r) => (
                    <RowView key={r.id} row={r} />
                  ))}
                  {b.rows.some((r) => r.id === "export") && (
                    <>
                      <p className="settings-status" role="status">
                        {exportStatus}
                      </p>
                      {exporting.at === "failed" && (
                        <p className="settings-error" role="alert">
                          The download could not be made. Nothing changed. Try again.
                        </p>
                      )}
                    </>
                  )}
                </section>
                ),
              )
          )}
        </div>
      </div>
    </div>
  );
}
