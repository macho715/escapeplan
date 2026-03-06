import React from "react";

import Simulator from "./Simulator.jsx";

export default function SimulatorTab({ liveDash, onLog }) {
  return <Simulator liveDash={liveDash} onLog={onLog} />;
}
