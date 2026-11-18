import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          ADMIN_API_KEY: "test-admin-key-for-local-preview-only-000",
          PUBLIC_BASE_URL: "https://giftoyz.test",
          INDEXABLE: "false",
          NCM_API_TOKEN: "test-ncm-token",
          NCM_BASE_URL: "https://demo.nepalcanmove.com",
          NCM_ALLOW_CREATE: "true",
          NCM_WEBHOOK_SECRET: "test-webhook-secret-0000000000",
          TELEGRAM_BOT_TOKEN: "123456:test-telegram-token",
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
