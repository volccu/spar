// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { lazyPanel } from "./lazyPanels";

function Hello({ name }: { name: string }) {
  return <p>hello {name}</p>;
}

describe("lazyPanel", () => {
  it("draws nothing until its chunk lands when the tap beats the fetch", async () => {
    let arrive: (c: typeof Hello) => void = () => {};
    const { Panel } = lazyPanel(() => new Promise<typeof Hello>((r) => (arrive = r)));
    render(<Panel name="a" />);
    expect(screen.queryByText("hello a")).toBeNull();
    await act(async () => arrive(Hello));
    expect(await screen.findByText("hello a")).toBeTruthy();
  });

  it("draws in the tap's own commit once it has been fetched", async () => {
    const { Panel, fetch } = lazyPanel(() => Promise.resolve(Hello));
    await fetch();
    render(<Panel name="b" />);
    // Synchronously: no tick between the tap and the panel.
    expect(screen.getByText("hello b")).toBeTruthy();
  });

  it("asks again after a fetch that failed", async () => {
    let calls = 0;
    const { fetch } = lazyPanel(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(Hello);
    });
    await expect(fetch()).rejects.toThrow("offline");
    await expect(fetch()).resolves.toBe(Hello);
    expect(calls).toBe(2);
  });
});

describe("lazyPanel retry after a failed tap", () => {
  it("draws the panel on a later tap once the network is back", async () => {
    const { Component } = await import("react");
    class Catch extends Component<{ children: unknown }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? <p>failed</p> : (this.props.children as never);
      }
    }
    let calls = 0;
    const { Panel } = lazyPanel(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(Hello);
    });
    const quiet = console.error;
    console.error = () => {};
    try {
      const first = render(
        <Catch>
          <Panel name="c" />
        </Catch>,
      );
      expect(await screen.findByText("failed")).toBeTruthy();
      first.unmount();
      render(
        <Catch>
          <Panel name="c" />
        </Catch>,
      );
      expect(await screen.findByText("hello c")).toBeTruthy();
    } finally {
      console.error = quiet;
    }
  });
});
