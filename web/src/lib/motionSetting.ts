import type { AtRule, Container, Plugin, Rule } from "postcss";

/**
 * The device's own "Reduced" motion setting, said to the stylesheet
 * (2026-10-11, owner approved: Settings → Motion → Reduced adds to
 * `prefers-reduced-motion` and never takes it away).
 *
 * A media query cannot be switched on by an attribute, and copying every
 * `@media (prefers-reduced-motion: reduce)` block by hand under
 * `[data-motion="reduced"]` is two copies that drift. So the stylesheet keeps
 * its one spelling and this PostCSS step, run by Vite in dev and in the build
 * (`css.postcss` in vite.config.ts), writes the second one:
 *
 * - every `@media (prefers-reduced-motion: reduce)` block is followed by the
 *   same rules again outside it, each selector behind
 *   `:where(:root[data-motion="reduced"])` — zero specificity and the very
 *   next place in the sheet, so with the setting on they cascade exactly as
 *   the media block does with the system preference on;
 * - every query that asks for `prefers-reduced-motion: no-preference` keeps
 *   its rules but puts each behind `:where(:root:not([data-motion="reduced"]))`,
 *   so the setting turns those off too.
 *
 * Anything else that mentions the preference — `reduce` beside another
 * condition — is refused rather than half-handled: it would need a copy
 * inside a media query of its own, and the next block like that should be
 * written so it does not.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";
const ON = ':where(:root[data-motion="reduced"])';
const OFF = ':where(:root:not([data-motion="reduced"]))';

function prefix(container: Container, scope: string): void {
  container.walkRules((rule: Rule) => {
    // A keyframe step's selector is a percentage, not an element.
    const parent = rule.parent as AtRule | undefined;
    if (parent?.type === "atrule" && /keyframes$/i.test(parent.name)) return;
    rule.selectors = rule.selectors.map((selector) => `${scope} ${selector}`);
  });
}

export function motionSetting(): Plugin {
  // PostCSS revisits a container after it changes; each block is handled once.
  const done = new WeakSet<AtRule>();
  return {
    postcssPlugin: "spar-motion-setting",
    AtRule: {
      media(at) {
        const query = at.params.replace(/\s+/g, " ").trim();
        if (!query.includes("prefers-reduced-motion")) return;
        if (query === REDUCE) {
          if (done.has(at)) return;
          done.add(at);
          const copy = at.clone();
          copy.walkComments((comment) => {
            comment.remove();
          });
          prefix(copy, ON);
          // A copy of the list: moving a node out of the clone shortens it.
          at.after([...(copy.nodes ?? [])]);
          return;
        }
        if (/prefers-reduced-motion:\s*no-preference/.test(query)) {
          if (done.has(at)) return;
          done.add(at);
          prefix(at, OFF);
          return;
        }
        throw at.error(
          `"${query}" mixes the motion preference with another condition; write it as its own ` +
            `${REDUCE} block so the device's setting can follow it (lib/motionSetting.ts).`,
        );
      },
    },
  };
}
