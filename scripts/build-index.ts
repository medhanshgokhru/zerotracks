import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/search/index";
import type { DocumentRecord } from "../src/search/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "data/documents.json");
const outputPath = resolve(root, "public/data/search-index.json");
const documents = JSON.parse(
	await readFile(inputPath, "utf8"),
) as DocumentRecord[];
const index = buildIndex(documents);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(index)}\n`);
console.log(
	`Indexed ${index.documents.length} unique documents and ${index.vocabulary.length} terms.`,
);
