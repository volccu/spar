import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * The whole-screen failure: the wordmark, one sentence, and Reload. Shared by
 * the crash screen below and by the ownership check in `App.tsx`, the two
 * states where the app has nothing else to put on the screen and a reload is
 * the entire remedy.
 */
export function Stopped({ message }: { message: string }) {
  return (
    <div className="signin">
      <div className="signin-box">
        <h1 className="wordmark signin-mark">spår</h1>
        <p className="signin-error stopped-error" role="alert">
          {message}
        </p>
        <button type="button" className="btn mono stopped-reload" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

interface State {
  failed: boolean;
}

/**
 * The one class component in the app, because catching a render-time throw is
 * the one thing hooks cannot do.
 *
 * Without it, anything thrown while rendering unmounts the entire tree and
 * leaves a white page with no message and nothing to press — the app looks
 * uninstalled rather than broken. The likeliest way in is not a bug at all:
 * `CanvasSheet` is loaded on demand, so a tab left open across a deploy asks
 * the host for a chunk filename that no longer exists, `lazy()` throws, and
 * opening an idea takes the whole board with it.
 *
 * A reload is the entire remedy, so the offer is a reload and nothing else. It
 * says the notes are safe because they are: this is a rendering failure, the
 * local store is untouched by it, and the first thing anyone wants to know
 * about a notes app showing an error is whether the notes are still there.
 *
 * It borrows the sign-in screen's box rather than bringing a stylesheet of its
 * own: when nothing else of the app is left on the screen, the wordmark is what
 * says this is still spår, and the error is drawn the way every error is — full
 * ink beside the 3px rule. It used to be the storage banner's raised bar across
 * the top of an otherwise black page, saying "Something went wrong", which is
 * the one sentence any app at all could have shown.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("spår: the app stopped rendering", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <Stopped message="Something went wrong on this screen. Your notes are safe on this device. Reload to open spår again." />;
  }
}
