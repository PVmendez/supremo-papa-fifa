#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { SupremoStack } from "../lib/supremo-stack";

const app = new App();

const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken || adminToken.length < 16) {
  throw new Error("Definí ADMIN_TOKEN (mínimo 16 caracteres) antes de sintetizar o desplegar. Ej: export ADMIN_TOKEN=$(openssl rand -hex 16)");
}

new SupremoStack(app, "SupremoPapaFifa", {
  adminToken,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});
