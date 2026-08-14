/**
 * The confirm dialog used to close in a `finally`, so a destructive action
 * that failed server-side still dismissed and read as done. These guard the
 * close-only-on-success contract that session discard and collection empty
 * both now rely on.
 */
import { DeleteDialog } from "@/components/delete-dialog";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

function renderDialog(onConfirm: () => void | Promise<unknown>) {
  const onOpenChange = vi.fn();
  render(
    <DeleteDialog
      open
      onOpenChange={onOpenChange}
      title="Discard run?"
      description="This cannot be undone."
      onConfirm={onConfirm}
    />,
  );
  return { onOpenChange };
}

async function clickConfirm() {
  // The simple mode has no keyword gate, so the confirm button is live.
  const button = screen
    .getAllByRole("button")
    .find((b) => b.textContent && !/cancel/i.test(b.textContent));
  await act(async () => {
    button?.click();
  });
}

describe("DeleteDialog", () => {
  it("closes when the confirm succeeds", async () => {
    const { onOpenChange } = renderDialog(() => Promise.resolve());
    await clickConfirm();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open when the confirm rejects", async () => {
    const { onOpenChange } = renderDialog(() =>
      Promise.reject(new Error("server said no")),
    );
    await clickConfirm();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("still closes for a synchronous confirm", async () => {
    // Most callers pass a plain void function; they must be unaffected.
    const { onOpenChange } = renderDialog(() => {});
    await clickConfirm();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
