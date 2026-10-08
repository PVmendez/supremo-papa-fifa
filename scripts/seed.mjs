// Carga (o actualiza) los invitados en DynamoDB y genera un link personal para cada uno.
//
//   TABLE_NAME=<output TableName> SITE_URL=<output SiteUrl> node seed.mjs
//
// Es idempotente: si un invitado ya existe conserva su código y su respuesta,
// solo actualiza nombre y foto. Los links quedan en links.local.txt (no se sube a git).

import { readFile, writeFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME;
const SITE = (process.env.SITE_URL || "").replace(/\/+$/, "");
if (!TABLE || !SITE) {
  console.error("Faltan variables: TABLE_NAME y SITE_URL (están en los outputs de cdk deploy).");
  process.exit(1);
}

// Sin 0/O, 1/I/L para que se puedan dictar sin confusión.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const guests = JSON.parse(await readFile(new URL("./guests.json", import.meta.url), "utf8"));

const used = new Set();
const lines = [];

for (const g of guests) {
  const existing = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { num: g.num } }))).Item;

  let code;
  if (existing) {
    code = existing.code;
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { num: g.num },
      UpdateExpression: "SET #n = :n, photo = :p",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: { ":n": g.name, ":p": g.photo ?? null },
    }));
  } else {
    do { code = newCode(); } while (used.has(code));
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { num: g.num, name: g.name, photo: g.photo ?? null, code, status: "pending" },
      ConditionExpression: "attribute_not_exists(num)",
    }));
  }
  used.add(code);
  lines.push(`#${String(g.num).padStart(2, "0")} ${g.name.padEnd(10)} ${SITE}/?c=${code}`);
}

const out = lines.join("\n") + "\n";
await writeFile(new URL("./links.local.txt", import.meta.url), out);
console.log(out);
console.log("Links guardados en scripts/links.local.txt");
