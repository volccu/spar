/**
 * Nothing that talks to a server starts until the archive is on screen.
 *
 * Being in its own chunk kept the sync client out of the first *download*; it
 * did not keep it out of the first *frame*. `useAuth` and `useNotes` both asked
 * for it in their mount effects, so on a returning device the chunk came
 * straight out of the precache and its parse — GoTrue, PostgREST, Realtime, a
 * constructor that starts a refresh timer and reads localStorage — landed on
 * the main thread in the same window as the first eighty cards. Nothing on the
 * paint path needs it: sync, sign-in state and push all settle behind the grid
 * by design. `useNotes` releases this the moment `loading` ends, and the cap is
 * for the day it does not.
 *
 * It lived in `store/supabase.ts` until the backend became a choice
 * (`store/backend/`): a build that reads its backend from `/config.json` waits
 * here too before it asks, so the gate belongs to no one backend. `shellReady`
 * is still exported from `store/supabase.ts`, where its callers import it.
 */
let releaseShell: () => void = () => {};
const shellDrawn = new Promise<void>((resolve) => {
  releaseShell = resolve;
});
const SHELL_CAP_MS = 3000;

/** The archive is on screen (or could not be read); the client may start. */
export function shellReady(): void {
  releaseShell();
}

/** Resolves once the archive is on screen, or after the cap. */
export function afterShell(): Promise<void> {
  return Promise.race([
    shellDrawn,
    new Promise<void>((resolve) => setTimeout(resolve, SHELL_CAP_MS)),
  ]);
}
