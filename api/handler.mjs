// API del torneo. Corre en Lambda (Node.js 20) detrás de una Function URL,
// a la que CloudFront enruta /api/*.
//
//   GET  /api/rsvps          -> estado público: nombre y foto solo de quienes ya respondieron
//   GET  /api/me?c=CODE      -> datos del invitado dueño del código
//   POST /api/rsvp           -> { code, status: "yes" | "no" }
//   POST /api/admin/reset    -> { num }  (header x-admin-token) vuelve a "pending"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { timingSafeEqual } from "node:crypto";

const TABLE = process.env.TABLE_NAME;
const CODE_INDEX = process.env.CODE_INDEX || "byCode";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const VALID = new Set(["yes", "no"]);
const CODE_RE = /^[A-Z0-9]{4,12}$/;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try { return JSON.parse(raw); } catch { return null; }
}

function publicView(item) {
  const answered = item.status === "yes" || item.status === "no";
  return answered
    ? { num: item.num, status: item.status, name: item.name, photo: item.photo ?? null }
    : { num: item.num, status: "pending" };
}

function privateView(item) {
  return { num: item.num, name: item.name, photo: item.photo ?? null, status: item.status || "pending" };
}

async function findByCode(code) {
  if (!code || !CODE_RE.test(code)) return null;
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: CODE_INDEX,
    KeyConditionExpression: "#c = :c",
    ExpressionAttributeNames: { "#c": "code" },
    ExpressionAttributeValues: { ":c": code },
    Limit: 1,
  }));
  return res.Items?.[0] ?? null;
}

async function setStatus(num, status) {
  const res = await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { num },
    UpdateExpression: "SET #s = :s, updatedAt = :t",
    ConditionExpression: "attribute_exists(num)",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": status, ":t": new Date().toISOString() },
    ReturnValues: "ALL_NEW",
  }));
  return res.Attributes;
}

function adminOk(event) {
  const given = event.headers?.["x-admin-token"] || "";
  if (!ADMIN_TOKEN || given.length !== ADMIN_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(ADMIN_TOKEN));
}

export async function handler(event) {
  const method = event.requestContext?.http?.method || "GET";
  const path = (event.rawPath || "/").replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const qs = event.queryStringParameters || {};

  try {
    if (method === "GET" && path === "/rsvps") {
      const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
      const guests = (res.Items || []).map(publicView).sort((a, b) => a.num - b.num);
      return json(200, { guests });
    }

    if (method === "GET" && path === "/me") {
      const item = await findByCode((qs.c || "").trim().toUpperCase());
      return item ? json(200, privateView(item)) : json(404, { error: "invalid_code" });
    }

    if (method === "POST" && path === "/rsvp") {
      const body = parseBody(event);
      if (!body) return json(400, { error: "invalid_json" });
      const status = String(body.status || "");
      if (!VALID.has(status)) return json(400, { error: "invalid_status" });
      const item = await findByCode(String(body.code || "").trim().toUpperCase());
      if (!item) return json(404, { error: "invalid_code" });
      const updated = await setStatus(item.num, status);
      return json(200, privateView(updated));
    }

    if (method === "POST" && path === "/admin/reset") {
      if (!adminOk(event)) return json(401, { error: "unauthorized" });
      const body = parseBody(event);
      const num = Number(body?.num);
      if (!Number.isInteger(num)) return json(400, { error: "invalid_num" });
      const updated = await setStatus(num, "pending");
      return json(200, privateView(updated));
    }

    return json(404, { error: "not_found" });
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") return json(404, { error: "not_found" });
    console.error(err);
    return json(500, { error: "server_error" });
  }
}
