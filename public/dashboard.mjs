const tiers = {
  free: { name: "Free", key: "12345-abcde", limit: 5 },
  pro: { name: "Pro", key: "67890-fghij", limit: 20 },
  admin: { name: "Admin", key: "admin-key-000", limit: 100 },
};
const element = (id) => document.getElementById(id);
const states = Object.fromEntries(
  Object.keys(tiers).map((tier) => [
    tier,
    { allowed: 0, blocked: 0, errors: 0, remaining: null, deadline: null, latency: null },
  ]),
);
let busy = false;

function render() {
  const tier = element("tier").value;
  const state = states[tier];
  for (const metric of ["allowed", "blocked", "errors"])
    element(metric).textContent = state[metric];
  element("remaining").textContent = state.remaining ?? "—";
  element("quota").max = tiers[tier].limit;
  element("quota").value = state.remaining ?? 0;
  element("latency").textContent = state.latency === null ? "—" : state.latency + " ms";
  const seconds =
    state.deadline === null ? null : Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  element("reset").textContent =
    seconds === null
      ? "No quota checked yet"
      : seconds === 0
        ? "A slot may be available. Send a request to check."
        : "Oldest request expires in " + seconds + "s";
}

async function sendOne(tier) {
  const started = performance.now();
  let status;
  let label;
  let className;
  const state = states[tier];
  try {
    const response = await fetch("/", {
      headers: { "x-api-key": tiers[tier].key },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    status = response.status;
    if (status === 200) {
      state.allowed++;
      label = "Allowed · 200";
      className = "allowed";
    } else if (status === 429) {
      state.blocked++;
      label = "Blocked · 429";
      className = "blocked";
    } else {
      state.errors++;
      label = "Error · " + status;
      className = "error";
    }
    // Concurrent replies can arrive out of order; retain the smallest remaining quota.
    if (typeof body.remainingRequests === "number") {
      if (state.deadline === null || state.deadline <= Date.now())
        state.remaining = body.remainingRequests;
      else
        state.remaining = Math.min(
          state.remaining ?? body.remainingRequests,
          body.remainingRequests,
        );
      state.deadline = Date.now() + body.resetInSeconds * 1000;
    }
  } catch {
    state.errors++;
    label = "Connection error";
    className = "error";
  }
  const latency = Math.round(performance.now() - started);
  state.latency = latency;
  element("empty")?.remove();
  const row = document.createElement("tr");
  for (const [index, value] of [
    new Date().toLocaleTimeString(),
    tiers[tier].name,
    label,
    latency + " ms",
  ].entries()) {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (index === 2) cell.className = className;
    row.append(cell);
  }
  element("activity").prepend(row);
  while (element("activity").children.length > 100) element("activity").lastElementChild.remove();
  render();
  return status;
}

async function sendBatch(count) {
  if (busy) return;
  busy = true;
  element("send").disabled =
    element("burst").disabled =
    element("tier").disabled =
    element("clear").disabled =
      true;
  const tier = element("tier").value;
  element("status").textContent = "Sending " + count + (count === 1 ? " request…" : " requests…");
  try {
    const results = await Promise.all(Array.from({ length: count }, () => sendOne(tier)));
    const allowed = results.filter((status) => status === 200).length;
    const blocked = results.filter((status) => status === 429).length;
    const errors = count - allowed - blocked;
    element("status").textContent =
      allowed + " allowed · " + blocked + " blocked · " + errors + " errors";
  } finally {
    busy = false;
    element("send").disabled =
      element("burst").disabled =
      element("tier").disabled =
      element("clear").disabled =
        false;
  }
}
element("send").addEventListener("click", () => sendBatch(1));
element("burst").addEventListener("click", () => sendBatch(10));
element("tier").addEventListener("change", () => {
  render();
  element("status").textContent = "Ready. Quotas are kept separately for each tier.";
});
element("clear").addEventListener("click", () => {
  for (const state of Object.values(states)) state.allowed = state.blocked = state.errors = 0;
  element("activity").replaceChildren();
  element("status").textContent = "Activity cleared. Server quotas are unchanged.";
  render();
});
setInterval(render, 1000);
render();
