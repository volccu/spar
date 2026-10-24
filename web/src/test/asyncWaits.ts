import { configure } from "@testing-library/dom";

/**
 * How long a `findBy…` or `waitFor` may look before it gives up — for every
 * test file, so that a find which only ran out while the whole suite was
 * running needs no edit in the file it happened in.
 *
 * The library's own default is one second. That is right for a unit and wrong
 * for these: they mount the whole app, and a screen that draws in 100 ms alone
 * draws in several seconds when a hundred and sixty files share the machine
 * (a lazy chunk has to be transformed on first use, too). A wait costs nothing
 * when the thing arrives and a test that is really broken still fails — later.
 * A file that needs more says so itself.
 */
configure({ asyncUtilTimeout: 10_000 });
