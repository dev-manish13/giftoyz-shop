export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  PUBLIC_BASE_URL: string;
  INDEXABLE: string;
  COD_ADVANCE?: string;
  ADMIN_API_KEY?: string;
  NCM_API_TOKEN?: string;
  NCM_BASE_URL?: string;
  NCM_PICKUP_BRANCH?: string;
  NCM_WEBHOOK_SECRET?: string;
  NCM_ALLOW_CREATE?: string;
  NCM_RATES_HOURS?: string;
  TELEGRAM_BOT_TOKEN?: string;
}

export type App = { Bindings: Env };

export const isHttps = (env: Env) => env.PUBLIC_BASE_URL.startsWith("https://");
export const isIndexable = (env: Env) => env.INDEXABLE === "true";
export const baseUrl = (env: Env) => env.PUBLIC_BASE_URL.replace(/\/+$/, "");
export const codDefault = (env: Env) => env.COD_ADVANCE !== "false";
export const now = () => Date.now() / 1000;
