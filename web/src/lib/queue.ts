/**
 * A queue that runs at most `limit` jobs at once and starts the next the
 * moment a slot frees.
 *
 * Built for the unfurl effect, which used to fire one request per eligible
 * link the moment it saw them. That was fine while "eligible" meant "just
 * written" — links arrive one note at a time — and then `PREVIEW_IMAGE_SINCE`
 * made every picture-less preview in the archive eligible again in the same
 * render, and one page load threw ~30 concurrent calls at the link-preview
 * function in a burst. A preview is enrichment, never a gate, so nothing
 * about one is worth arriving all at once.
 *
 * Deliberately not a promise pool: nobody awaits an unfurl, so returning the
 * job's promise would only invite someone to. Enqueue and walk away.
 */
export function boundedQueue(limit: number): (job: () => Promise<void>) => void {
  const waiting: (() => Promise<void>)[] = [];
  let running = 0;

  const pump = () => {
    while (running < limit && waiting.length > 0) {
      const job = waiting.shift()!;
      running += 1;
      void job()
        .catch(() => {
          // A job that throws is a job that finished. Swallowed, because
          // nothing upstream is listening — the queue exists for pacing, not
          // error handling, and an unhandled rejection in the console would
          // be the only effect of letting it out.
        })
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  return (job) => {
    waiting.push(job);
    pump();
  };
}
