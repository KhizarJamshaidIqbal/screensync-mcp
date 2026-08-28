import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    ...process.env,
    SCREEN_SYNC_PORT: "3001",
  } as Record<string, string>,
});
const client = new Client({ name: "screensync-e2e", version: "1.0.0" });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "get_device_status",
      "get_latest_screenshot",
      "get_mcp_catalog",
      "get_recent_screenshots",
      "get_skills",
      "list_recent_screens",
      "publish_inspection",
      "publish_patch",
    ],
  );

  const prompts = await client.listPrompts();
  assert(prompts.prompts.some((prompt) => prompt.name === "inspect_latest_mobile_screen"));

  const resources = await client.listResources();
  assert(resources.resources.some((resource) => resource.uri === "screensync://status"));
  assert(resources.resources.some((resource) => resource.uri === "screensync://workflow"));
  assert(resources.resources.some((resource) => resource.uri === "screensync://skills"));

  const skills = await client.callTool({ name: "get_skills", arguments: {} });
  assert.notEqual(skills.isError, true);

  const recentShots = await client.callTool({ name: "get_recent_screenshots", arguments: { limit: 2 } });
  assert.notEqual(recentShots.isError, true);
  assert((recentShots.content as Array<{ type: string }>).some((c) => c.type === "image"));

  const statusResource = await client.readResource({ uri: "screensync://status" });
  assert.equal(statusResource.contents[0]?.mimeType, "application/json");

  const prompt = await client.getPrompt({
    name: "inspect_latest_mobile_screen",
    arguments: { focus: "RenderFlex overflow and accessibility" },
  });
  assert(prompt.messages[0]?.content.type === "text");

  const status = await client.callTool({ name: "get_device_status", arguments: {} });
  assert.notEqual(status.isError, true);

  const catalog = await client.callTool({ name: "get_mcp_catalog", arguments: {} });
  assert.notEqual(catalog.isError, true);
  const catalogBody = JSON.parse(
    String((catalog.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}"),
  ) as {
    tools?: Array<{ name: string }>;
    prompts?: Array<{ name: string }>;
    resources?: Array<{ uri: string }>;
    connection?: { stdio?: { command: string }; httpHub?: { bearerToken: string } };
  };
  assert.equal(catalogBody.tools?.length, 8);
  assert(catalogBody.tools?.some((t) => t.name === "get_mcp_catalog"));
  assert(catalogBody.prompts?.some((p) => p.name === "inspect_latest_mobile_screen"));
  assert.equal(catalogBody.resources?.length, 3);
  assert.equal(catalogBody.connection?.stdio?.command, "node");
  assert(catalogBody.connection?.httpHub?.bearerToken);

  const recent = await client.callTool({ name: "list_recent_screens", arguments: { limit: 3 } });
  assert.notEqual(recent.isError, true);

  const latest = await client.callTool({
    name: "get_latest_screenshot",
    arguments: { includeMetadata: true },
  });
  assert.notEqual(latest.isError, true);
  assert(Array.isArray(latest.content));
  const image = latest.content.find((item) => item.type === "image");
  assert(image && image.type === "image");
  assert(["image/png", "image/jpeg"].includes(image.mimeType));
  assert(image.data.length > 1000);

  process.stdout.write(
    JSON.stringify(
      {
        success: true,
        tools: tools.tools.map((tool) => tool.name),
        prompts: prompts.prompts.map((item) => item.name),
        resources: resources.resources.map((item) => item.uri),
        imageMimeType: image.mimeType,
        imageBase64Chars: image.data.length,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
