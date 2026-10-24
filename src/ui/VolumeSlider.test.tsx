// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VolumeSlider } from "./VolumeSlider";

afterEach(cleanup);

describe("VolumeSlider", () => {
  it("uses a native range and applies input continuously without pointer capture", () => {
    const onChange = vi.fn();
    render(<VolumeSlider value={80} onChange={onChange} label="Громкость" />);
    const slider = screen.getByRole("slider", { name: "Громкость" }) as HTMLInputElement;
    expect(slider.type).toBe("range");
    fireEvent.input(slider, { target: { value: "40" } });
    fireEvent.input(slider, { target: { value: "12" } });
    expect(onChange.mock.calls).toEqual([[40], [12]]);
  });

  it("accepts mute and maximum volume", () => {
    const onChange = vi.fn();
    render(<VolumeSlider value={50} onChange={onChange} label="Volume" />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.change(slider, { target: { value: "100" } });
    expect(onChange.mock.calls).toEqual([[0], [100]]);
  });

  it("reflects external changes, including mute, without stale drag state", () => {
    const onChange = vi.fn();
    const { rerender } = render(<VolumeSlider value={70} onChange={onChange} label="Volume" />);
    fireEvent.input(screen.getByRole("slider"), { target: { value: "20" } });
    rerender(<VolumeSlider value={0} onChange={onChange} label="Volume" />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("0");
    expect(slider.getAttribute("aria-valuetext")).toBe("0%");
    expect(slider.style.getPropertyValue("--volume-pct")).toBe("0%");
  });
});
