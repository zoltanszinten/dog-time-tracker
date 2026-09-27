"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const folder = __dirname;
const pageFile = path.join(folder, "Dog Time.html");
const dataFile = path.join(folder, "dog-time-data.json");
const backupFile = path.join(folder, "dog-time-data.backup.json");
const port = Number(process.env.DOG_TIME_PORT || 8765);
const shouldOpen = !process.argv.includes("--no-open");

function validDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === date;
}

function validEntry(entry) {
  return entry && typeof entry.id === "string" && entry.id.length > 0 && entry.id.length <= 100 &&
    validDay(entry.day) && Number.isInteger(entry.minutes) && entry.minutes >= 1 && entry.minutes <= 1440 &&
    Number.isSafeInteger(entry.created) && entry.created > 0;
}

function readEntries() {
  if (!fs.existsSync(dataFile)) return [];
  const entries = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (!Array.isArray(entries) || !entries.every(validEntry)) throw new Error("The saved data file is invalid. Check the backup file before changing it.");
  return entries;
}

function writeEntries(entries) {
  const temporaryFile = path.join(folder, `.dog-time-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(entries, null, 2) + "\n", "utf8");
    if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, backupFile);
    fs.renameSync(temporaryFile, dataFile);
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) {
      send(res, 403, { error: "This request must come from Dog Time." });
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/Dog%20Time.html")) {
      send(res, 200, fs.readFileSync(pageFile), "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/ui.css") {
      send(res, 200, fs.readFileSync(path.join(folder, "ui.css")), "text/css; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/entries") {
      send(res, 200, { entries: readEntries() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/entries") {
      const body = await readBody(req);
      if (!validDay(body?.day) || !Number.isInteger(body?.minutes) || body.minutes < 1 || body.minutes > 1440) {
        send(res, 400, { error: "Enter a whole number from 1 to 1440 minutes." });
        return;
      }
      const entries = readEntries();
      entries.push({ id: crypto.randomUUID(), day: body.day, minutes: body.minutes, created: Date.now() });
      writeEntries(entries);
      send(res, 201, { entries });
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/entries/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/entries/".length));
      const entries = readEntries();
      const next = entries.filter(entry => entry.id !== id);
      if (next.length === entries.length) { send(res, 404, { error: "Entry not found." }); return; }
      writeEntries(next);
      send(res, 200, { entries: next });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      const body = await readBody(req);
      if (!Array.isArray(body?.entries) || body.entries.length > 5000 || !body.entries.every(validEntry)) {
        send(res, 400, { error: "This is not a valid Dog Time export." });
        return;
      }
      const entries = readEntries();
      const ids = new Set(entries.map(entry => entry.id));
      let imported = 0;
      for (const entry of body.entries) {
        if (ids.has(entry.id)) continue;
        entries.push({ id: entry.id, day: entry.day, minutes: entry.minutes, created: entry.created });
        ids.add(entry.id);
        imported++;
      }
      if (imported) writeEntries(entries);
      send(res, 200, { entries, imported });
      return;
    }
    send(res, 404, { error: "Not found." });
  } catch (error) {
    const badRequest = error instanceof SyntaxError || error.message === "Request is too large.";
    console.error(error);
    send(res, badRequest ? 400 : 500, { error: badRequest ? "Invalid request." : "Could not read or save the data file." });
  }
});

server.listen(port, "127.0.0.1", () => {
  if (!fs.existsSync(dataFile)) writeEntries([]);
  const address = `http://127.0.0.1:${port}/`;
  console.log(`Dog Time is running at ${address}`);
  console.log(`Entries are saved in ${dataFile}`);
  console.log("Close this window to stop Dog Time.");
  if (shouldOpen && process.platform === "win32") {
    const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", address], { detached: true, stdio: "ignore" });
    child.unref();
  }
});

server.on("error", error => {
  console.error(`Could not start Dog Time: ${error.message}`);
  process.exitCode = 1;
});
