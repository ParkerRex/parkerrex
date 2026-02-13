#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "<!-- PROJECTS:START -->";
const END_MARKER = "<!-- PROJECTS:END -->";
const DEFAULT_OWNER = "ParkerRex";
const DEFAULT_DAYS = 30;
const DEFAULT_EXCLUDES = new Set(["parkerrex", "jobbi", "truemed"]);

function parseArgs(argv) {
  const args = {
    owner: DEFAULT_OWNER,
    days: DEFAULT_DAYS,
    readmePath: "README.md",
    excludes: new Set(DEFAULT_EXCLUDES),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--owner" && argv[i + 1]) {
      args.owner = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--days" && argv[i + 1]) {
      const parsedDays = Number.parseInt(argv[i + 1], 10);
      if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
        throw new Error(`Invalid --days value: ${argv[i + 1]}`);
      }
      args.days = parsedDays;
      i += 1;
      continue;
    }
    if (token === "--readme" && argv[i + 1]) {
      args.readmePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--exclude" && argv[i + 1]) {
      args.excludes.add(argv[i + 1].toLowerCase());
      i += 1;
      continue;
    }
  }

  return args;
}

function runGh(args, options = {}) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim() ?? "Unknown gh error";
    throw new Error(`gh ${args.join(" ")} failed: ${stderr}`);
  }
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeBase64Content(content) {
  const normalized = content.replace(/\n/g, "");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function normalizeRepoName(name) {
  return name
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanSentence(input, maxLength = 160) {
  const compact = input
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractField(markdown, fieldLabel) {
  const pattern = new RegExp(
    `^\\s*(?:[-*]\\s*)?(?:\\*\\*|__)?\\s*${escapeRegex(fieldLabel)}\\s*(?:\\*\\*|__)?\\s*:\\s*(.+?)\\s*$`,
    "im",
  );
  const match = markdown.match(pattern);
  return match ? cleanSentence(match[1]) : "";
}

function firstMeaningfulLine(markdown) {
  const lines = markdown.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalizedLine = cleanSentence(line, 260);
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith(">")) continue;
    if (line.startsWith("```")) continue;
    if (line.startsWith("![")) continue;
    if (line.startsWith("[![")) continue;
    if (/^\s*[-*]\s*$/.test(line)) continue;
    if (/^\s*[-*]\s+/.test(line)) continue;
    if (/^\s*(project name|one liner|one-liner|stack|problem)\s*:/i.test(line))
      continue;
    if (isUnhelpfulSummary(normalizedLine)) continue;
    return normalizedLine;
  }
  return "";
}

function isUnhelpfulSummary(text) {
  if (!text) return true;
  if (text.length < 12) return true;
  if (text.endsWith(":")) return true;

  const patterns = [
    /^\d+\.\s*overview$/i,
    /^overview$/i,
    /^last updated\s*:/i,
    /^this repo contains:?$/i,
    /^first,?\s*run the development server:?$/i,
    /^run the development server:?$/i,
    /^open https?:\/\/localhost:\d+/i,
    /^this is a .*project bootstrapped with/i,
    /^you can start editing the page by modifying app\/page\.tsx/i,
    /^this project uses next\/font/i,
    /^you can check out the next\.js github repository/i,
    /^learn more about next\.js/i,
    /^the easiest way to deploy your next\.js app/i,
    /^check out our next\.js deployment documentation/i,
    /^\d+\.\s+[a-z].*$/i,
    /^\d+\.\s*quick start$/i,
    /^getting started$/i,
    /^installation$/i,
    /^usage$/i,
    /^quick start$/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function pickBestSummary(candidates) {
  for (const rawCandidate of candidates) {
    const candidate = cleanSentence(rawCandidate || "");
    if (!candidate) continue;
    if (isUnhelpfulSummary(candidate)) continue;
    return candidate;
  }
  return "";
}

function getPublicRepos(owner) {
  const output = runGh([
    "repo",
    "list",
    owner,
    "--limit",
    "200",
    "--json",
    "name,description,url,pushedAt,isFork,isArchived",
  ]);
  return JSON.parse(output);
}

function getReadmeMarkdown(owner, repoName) {
  try {
    const output = runGh(["api", `repos/${owner}/${repoName}/readme`]);
    const payload = JSON.parse(output);
    if (payload.encoding !== "base64" || !payload.content) return "";
    return decodeBase64Content(payload.content);
  } catch {
    return "";
  }
}

function buildProjectLine(repo, readmeMarkdown) {
  const projectName = extractField(readmeMarkdown, "Project name");
  const oneLinerField =
    extractField(readmeMarkdown, "One liner") ||
    extractField(readmeMarkdown, "One-liner");
  const problemField = extractField(readmeMarkdown, "Problem");
  const oneLiner =
    pickBestSummary([
      oneLinerField,
      repo.description || "",
      problemField,
      firstMeaningfulLine(readmeMarkdown),
    ]) || `${normalizeRepoName(repo.name)} project`;

  const displayName = cleanSentence(projectName || repo.name, 80);
  return `- **[${displayName}](${repo.url})** - ${oneLiner}`;
}

function replaceMarkerBlock(readme, sectionBody) {
  const startIndex = readme.indexOf(START_MARKER);
  const endIndex = readme.indexOf(END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(
      `README is missing valid project markers: ${START_MARKER} ... ${END_MARKER}`,
    );
  }

  const before = readme.slice(0, startIndex + START_MARKER.length);
  const after = readme.slice(endIndex);
  return `${before}\n${sectionBody}\n${after}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const readmeAbsolutePath = path.resolve(process.cwd(), args.readmePath);

  const repos = getPublicRepos(args.owner)
    .filter((repo) => !repo.isFork && !repo.isArchived)
    .filter((repo) => !args.excludes.has(repo.name.toLowerCase()))
    .filter((repo) => Date.parse(repo.pushedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt));

  const lines = repos.map((repo) =>
    buildProjectLine(repo, getReadmeMarkdown(args.owner, repo.name)),
  );

  const sectionBody =
    lines.length > 0
      ? lines.join("\n")
      : "- No project updates in the last 30 days.";

  const currentReadme = fs.readFileSync(readmeAbsolutePath, "utf8");
  const nextReadme = replaceMarkerBlock(currentReadme, sectionBody);

  if (nextReadme !== currentReadme) {
    fs.writeFileSync(readmeAbsolutePath, nextReadme);
    console.log(`Updated ${args.readmePath} with ${lines.length} project entries.`);
    return;
  }

  console.log(`${args.readmePath} already up to date.`);
}

main();
