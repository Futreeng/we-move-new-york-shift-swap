import http from "node:http";

const port = Number(process.env.REDIS_REST_PORT ?? "8079");
const token = process.env.REDIS_REST_TOKEN ?? "ci-test-redis-token";
const values = new Map();
const expirations = new Map();

function encode(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function purge(key) {
  const expiresAt = expirations.get(key);
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    expirations.delete(key);
    values.delete(key);
  }
}

function run(command) {
  const [name, ...args] = command.map((value) => String(value));
  const key = args[0];
  if (key) purge(key);

  switch (name.toUpperCase()) {
    case "PING":
      return encode("PONG");
    case "GET":
      return values.has(key) ? encode(values.get(key)) : null;
    case "SET": {
      values.set(key, args[1]);
      const exIndex = args.findIndex((value) => value.toUpperCase() === "EX");
      if (exIndex !== -1) expirations.set(key, Date.now() + Number(args[exIndex + 1]) * 1000);
      return "OK";
    }
    case "INCR": {
      const next = Number(values.get(key) ?? 0) + 1;
      values.set(key, String(next));
      return next;
    }
    case "EXPIRE":
      if (values.has(key)) expirations.set(key, Date.now() + Number(args[1]) * 1000);
      return values.has(key) ? 1 : 0;
    default:
      throw new Error(`Unsupported Redis command: ${name}`);
  }
}

const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  let raw = "";
  for await (const chunk of request) raw += chunk;
  try {
    const body = JSON.parse(raw);
    const commands = Array.isArray(body[0]) ? body : [body];
    const results = commands.map((command) => ({ result: run(command) }));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(body[0]) ? results : results[0]));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Bad request" }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Redis REST test server listening on ${port}`);
});
