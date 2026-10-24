/**
 * The reminder projection's golden vectors, as the conformance suite holds a
 * backend to them.
 *
 * Not a copy: the one table lives in web/src/test/reminderVectors.ts, where
 * web/src/lib/reminders.test.ts holds the TypeScript projection to it, and is
 * read here so the backend's projection answers to the very same rows (audit
 * CODE-4). Each row also carries `next`, which only the app's side reads.
 */
export { GOLDEN, type Vector } from "../web/src/test/reminderVectors";
