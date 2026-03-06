import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import IntelTab from "./IntelTab.jsx";
import { createDashboard } from "../../test/fixtures.js";

describe("IntelTab", () => {
  it("shows counts from the full feed while rendering the filtered list", () => {
    const intelFeed = createDashboard().intelFeed;

    render(<IntelTab intelFeed={intelFeed} />);

    expect(screen.getByRole("button", { name: /ALL \(3\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CRITICAL \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText("Critical airspace update")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /HIGH \(1\)/i }));
    expect(screen.getByText("Border congestion rising")).toBeInTheDocument();
    expect(screen.queryByText("Critical airspace update")).not.toBeInTheDocument();
  });
});
