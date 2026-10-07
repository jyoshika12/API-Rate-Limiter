import app, { redis } from "./app.js";

const port = Number(process.env.PORT ?? 5000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
const server = app.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string")
    console.log("Server running at http://localhost:" + address.port);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () =>
    server.close(() => {
      redis.disconnect();
    }),
  );
}
