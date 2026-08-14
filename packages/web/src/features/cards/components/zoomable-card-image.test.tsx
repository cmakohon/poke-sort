// Real i18n, so assertions read what a user reads rather than raw keys.
import "@/lib/i18n";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ZoomableCardImage } from "./zoomable-card-image";

afterEach(cleanup);

const SRC = "/api/captures/scan.jpeg";

function openLightbox() {
  const button = screen.getByRole("button", { name: /enlarge/i });
  act(() => {
    button.click();
  });
}

describe("ZoomableCardImage", () => {
  it("shows the thumbnail as something you can click", () => {
    render(<ZoomableCardImage src={SRC} alt="Energy Switch" />);
    expect(
      screen.getByRole("button", { name: /Enlarge Energy Switch/i }),
    ).toBeDefined();
  });

  it("opens the image large on click", () => {
    render(<ZoomableCardImage src={SRC} alt="Energy Switch" />);
    // Only the thumbnail before the click.
    expect(screen.getAllByAltText("Energy Switch")).toHaveLength(1);
    openLightbox();
    expect(screen.getAllByAltText("Energy Switch").length).toBeGreaterThan(1);
  });

  it("offers a way out", () => {
    render(<ZoomableCardImage src={SRC} alt="Energy Switch" />);
    openLightbox();
    expect(screen.getByRole("button", { name: /close/i })).toBeDefined();
  });

  /**
   * The detail panel listens for Escape on the document to close itself. With
   * the lightbox open that would fire too, dismissing the whole panel when the
   * user only meant to put the picture down — so the panel checks for an open
   * dialog, and this is the marker it checks for.
   */
  it("marks the open dialog so the panel can stand down", () => {
    render(<ZoomableCardImage src={SRC} alt="Energy Switch" />);
    expect(
      document.querySelector('[data-slot="dialog-content"][data-open]'),
    ).toBeNull();
    openLightbox();
    expect(
      document.querySelector('[data-slot="dialog-content"][data-open]'),
    ).not.toBeNull();
  });

  it("renders nothing without an image", () => {
    const { container } = render(<ZoomableCardImage src="" alt="Missing" />);
    expect(container.firstChild).toBeNull();
  });
});
